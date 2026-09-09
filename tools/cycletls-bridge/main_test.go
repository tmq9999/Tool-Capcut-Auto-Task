package main

import (
	"bytes"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
)

func TestLoopbackAddressAcceptsValidPort(t *testing.T) {
	address, err := loopbackAddress("49152")
	if err != nil {
		t.Fatalf("loopbackAddress returned error: %v", err)
	}
	if address != "127.0.0.1:49152" {
		t.Fatalf("loopbackAddress = %q, want %q", address, "127.0.0.1:49152")
	}
}

func TestLoopbackAddressRejectsInvalidPort(t *testing.T) {
	tests := []string{"", "0", "65536", "-1", "9119x", " 9119", "+9119"}
	for _, value := range tests {
		t.Run(strconv.Quote(value), func(t *testing.T) {
			if _, err := loopbackAddress(value); err == nil {
				t.Fatalf("loopbackAddress(%q) succeeded, want error", value)
			}
		})
	}
}

func TestListenLoopbackBindsOnlyIPv4Loopback(t *testing.T) {
	probe, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve local port: %v", err)
	}
	port := probe.Addr().(*net.TCPAddr).Port
	if err := probe.Close(); err != nil {
		t.Fatalf("close port probe: %v", err)
	}

	listener, err := listenLoopback(strconv.Itoa(port))
	if err != nil {
		t.Fatalf("listenLoopback returned error: %v", err)
	}
	t.Cleanup(func() { _ = listener.Close() })

	address, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		t.Fatalf("listener address type = %T, want *net.TCPAddr", listener.Addr())
	}
	if !address.IP.IsLoopback() || address.IP.To4() == nil {
		t.Fatalf("listener bound to %v, want IPv4 loopback", address.IP)
	}
}

func TestListenLoopbackRejectsInvalidPortBeforeBinding(t *testing.T) {
	if _, err := listenLoopback("0"); err == nil {
		t.Fatal("listenLoopback(0) succeeded, want validation error")
	}
}

func TestStartBridgeAnnouncesOwnedListenerAfterBinding(t *testing.T) {
	probe, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve local port: %v", err)
	}
	port := probe.Addr().(*net.TCPAddr).Port
	if err := probe.Close(); err != nil {
		t.Fatalf("close port probe: %v", err)
	}
	var ready bytes.Buffer

	server, listener, err := startBridge(strconv.Itoa(port), &ready)
	if err != nil {
		t.Fatalf("startBridge returned error: %v", err)
	}
	t.Cleanup(func() {
		_ = server.Close()
		_ = listener.Close()
	})
	if ready.String() != "READY:"+strconv.Itoa(port)+"\n" {
		t.Fatalf("readiness = %q", ready.String())
	}
}

func TestStartBridgeDoesNotAnnounceOccupiedPort(t *testing.T) {
	occupied, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("occupy local port: %v", err)
	}
	t.Cleanup(func() { _ = occupied.Close() })
	port := occupied.Addr().(*net.TCPAddr).Port
	var ready bytes.Buffer

	if _, _, err := startBridge(strconv.Itoa(port), &ready); err == nil {
		t.Fatal("startBridge succeeded on occupied port")
	}
	if ready.Len() != 0 {
		t.Fatalf("readiness emitted before ownership: %q", ready.String())
	}
}

func TestWebsocketHandlerAllowsRootFromLoopbackWithoutOrigin(t *testing.T) {
	called := false
	handler := websocketHandler(func(response http.ResponseWriter, request *http.Request) {
		called = true
		response.WriteHeader(http.StatusSwitchingProtocols)
	})
	request := httptest.NewRequest(http.MethodGet, "http://localhost/", nil)
	request.RemoteAddr = "127.0.0.1:50000"
	request.Header.Set("Connection", "Upgrade")
	request.Header.Set("Upgrade", "websocket")
	request.Header.Set("Sec-WebSocket-Version", "13")
	request.Header.Set("Sec-WebSocket-Key", "AQIDBAUGBwgJCgsMDQ4PEA==")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if !called {
		t.Fatal("endpoint was not called for an origin-free loopback request")
	}
	if response.Code != http.StatusSwitchingProtocols {
		t.Fatalf("response status = %d, want %d", response.Code, http.StatusSwitchingProtocols)
	}
}

func TestWebsocketHandlerRejectsOriginHeader(t *testing.T) {
	assertRejectedRequest(t, "/", "127.0.0.1:50000", "https://example.test", http.StatusForbidden)
}

func TestWebsocketHandlerRejectsNonLoopbackPeer(t *testing.T) {
	assertRejectedRequest(t, "/", "192.0.2.1:50000", "", http.StatusForbidden)
}

func TestWebsocketHandlerRejectsNonRootPath(t *testing.T) {
	assertRejectedRequest(t, "/debug", "127.0.0.1:50000", "", http.StatusNotFound)
}

func TestWebsocketHandlerRejectsNonGetRequest(t *testing.T) {
	assertRejectedRequestWithMethod(t, http.MethodPost, "/", "127.0.0.1:50000", "", true, http.StatusBadRequest)
}

func TestWebsocketHandlerRejectsMissingUpgrade(t *testing.T) {
	assertRejectedRequestWithMethod(t, http.MethodGet, "/", "127.0.0.1:50000", "", false, http.StatusBadRequest)
}

func TestWebsocketHandlerRejectsIncompleteHandshake(t *testing.T) {
	called := false
	handler := websocketHandler(func(http.ResponseWriter, *http.Request) { called = true })
	request := httptest.NewRequest(http.MethodGet, "http://localhost/", nil)
	request.RemoteAddr = "127.0.0.1:50000"
	request.Header.Set("Connection", "Upgrade")
	request.Header.Set("Upgrade", "websocket")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if called {
		t.Fatal("endpoint was called without WebSocket version and key")
	}
	if response.Code != http.StatusBadRequest {
		t.Fatalf("response status = %d, want %d", response.Code, http.StatusBadRequest)
	}
}

func assertRejectedRequest(t *testing.T, path string, remoteAddress string, origin string, expectedStatus int) {
	t.Helper()
	assertRejectedRequestWithMethod(t, http.MethodGet, path, remoteAddress, origin, true, expectedStatus)
}

func assertRejectedRequestWithMethod(t *testing.T, method string, path string, remoteAddress string, origin string, upgrade bool, expectedStatus int) {
	t.Helper()
	called := false
	handler := websocketHandler(func(http.ResponseWriter, *http.Request) { called = true })
	request := httptest.NewRequest(method, "http://localhost"+path, nil)
	request.RemoteAddr = remoteAddress
	if origin != "" {
		request.Header.Set("Origin", origin)
	}
	if upgrade {
		request.Header.Set("Connection", "Upgrade")
		request.Header.Set("Upgrade", "websocket")
		request.Header.Set("Sec-WebSocket-Version", "13")
		request.Header.Set("Sec-WebSocket-Key", "AQIDBAUGBwgJCgsMDQ4PEA==")
	}
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if called {
		t.Fatal("endpoint was called for a rejected request")
	}
	if response.Code != expectedStatus {
		t.Fatalf("response status = %d, want %d", response.Code, expectedStatus)
	}
}
