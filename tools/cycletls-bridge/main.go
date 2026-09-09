package main

import (
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/Danny-Dasilva/CycleTLS/cycletls"
)

func loopbackAddress(portValue string) (string, error) {
	port, err := strconv.Atoi(portValue)
	if err != nil || portValue != strconv.Itoa(port) || port < 1 || port > 65535 {
		return "", fmt.Errorf("WS_PORT must be a decimal integer from 1 through 65535")
	}
	return net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), nil
}

func listenLoopback(portValue string) (net.Listener, error) {
	address, err := loopbackAddress(portValue)
	if err != nil {
		return nil, err
	}
	return net.Listen("tcp4", address)
}

func websocketHandler(endpoint http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/" {
			http.NotFound(response, request)
			return
		}
		if request.Method != http.MethodGet || !validWebsocketUpgrade(request.Header) {
			http.Error(response, "websocket upgrade required", http.StatusBadRequest)
			return
		}
		for name := range request.Header {
			if strings.EqualFold(name, "Origin") {
				http.Error(response, "forbidden", http.StatusForbidden)
				return
			}
		}
		host, _, err := net.SplitHostPort(request.RemoteAddr)
		peerIP := net.ParseIP(host)
		if err != nil || peerIP == nil || !peerIP.IsLoopback() {
			http.Error(response, "forbidden", http.StatusForbidden)
			return
		}
		endpoint(response, request)
	})
}

func validWebsocketUpgrade(headers http.Header) bool {
	if !headerContainsToken(headers, "Connection", "upgrade") || !headerContainsToken(headers, "Upgrade", "websocket") || headers.Get("Sec-WebSocket-Version") != "13" {
		return false
	}
	decodedKey, err := base64.StdEncoding.DecodeString(headers.Get("Sec-WebSocket-Key"))
	return err == nil && len(decodedKey) == 16
}

func headerContainsToken(headers http.Header, name string, expected string) bool {
	for _, value := range headers.Values(name) {
		for _, token := range strings.Split(value, ",") {
			if strings.EqualFold(strings.TrimSpace(token), expected) {
				return true
			}
		}
	}
	return false
}

func run(portValue string) error {
	server, listener, err := startBridge(portValue, os.Stdout)
	if err != nil {
		return err
	}
	defer listener.Close()
	return server.Serve(listener)
}

func startBridge(portValue string, readiness io.Writer) (*http.Server, net.Listener, error) {
	listener, err := listenLoopback(portValue)
	if err != nil {
		return nil, nil, err
	}

	mux := http.NewServeMux()
	mux.Handle("/", websocketHandler(cycletls.WSEndpoint))
	server := &http.Server{Handler: mux}
	if _, err := fmt.Fprintf(readiness, "READY:%s\n", portValue); err != nil {
		_ = listener.Close()
		return nil, nil, err
	}
	return server, listener, nil
}

func main() {
	if err := run(os.Getenv("WS_PORT")); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
