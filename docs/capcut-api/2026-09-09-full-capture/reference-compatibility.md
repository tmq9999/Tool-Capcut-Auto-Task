# Public signer reference compatibility

## Scope and conclusion

This is a static compatibility review of two public TikTok signer repositories. It covers repository metadata, README/manifests, public call shapes, runtime dependencies, and licensing at the pinned commits below. No signer was executed, no external signing service was called, and no account, cookie, session, or signature value was used.

**Decision: neither repository can be assumed compatible with CapCut.** Both identify TikTok Web as their target and their examples use TikTok's application ID `1988`. This project's capture identifies CapCut with application ID `348188`. Sharing query-field names does not prove shared application configuration, SDK state, accepted signature generation, or server-side validation. Any future use would require separate CapCut-specific, captured evidence and an independently validated adapter; it must fail closed when that evidence is absent.

## Repository identity and pinning

| Reference | Public revision reviewed | Target and pinned runtime | Release state |
|---|---|---|---|
| [`bolocuixue/X-Bogus_X-GnarlyDOU_K`](https://github.com/bolocuixue/X-Bogus_X-GnarlyDOU_K/tree/34717ba7cb25f3803a9d954fdf05a27d6bfb765b) | `34717ba7cb25f3803a9d954fdf05a27d6bfb765b` | README and package identify a TikTok Web signer; example URL uses `aid=1988`. The repository bundles local snapshots named `webmssdk 1.0.0.374` and `webmssdk_ex 1.0.0.2620`, plus an unversioned `secsdk-lastest` snapshot. Package version is `1.0.0`. | GitHub reports no tags or releases. Pin by commit, not `main` or a semver range. |
| [`justbeluga/tiktok-web-reverse-engineering`](https://github.com/justbeluga/tiktok-web-reverse-engineering/tree/cdf104fd011bc0d07ef22c954eae949014c349b8) | `cdf104fd011bc0d07ef22c954eae949014c349b8` | The misspelled URL `justbeluga/tiktok-web-reverse-enginering` is a 404; GitHub repository search resolves the actual name shown here. Metadata and README explicitly target TikTok. The checked-in DOM asset is named `webmssdk_5.1.2.js`; the non-DOM demo supplies a `5.1.1` generation string. The README advertises a separate commercial “5.2.0” offering, which is not a pinned open-source package contract. DOM examples use `aid=1988`. | GitHub reports no tags or releases. Pin by commit. |

Sources: [bolocuixue repository metadata](https://api.github.com/repos/bolocuixue/X-Bogus_X-GnarlyDOU_K), [bolocuixue tree](https://api.github.com/repos/bolocuixue/X-Bogus_X-GnarlyDOU_K/git/trees/34717ba7cb25f3803a9d954fdf05a27d6bfb765b?recursive=1), [bolocuixue README](https://raw.githubusercontent.com/bolocuixue/X-Bogus_X-GnarlyDOU_K/34717ba7cb25f3803a9d954fdf05a27d6bfb765b/README.md), [bolocuixue package](https://raw.githubusercontent.com/bolocuixue/X-Bogus_X-GnarlyDOU_K/34717ba7cb25f3803a9d954fdf05a27d6bfb765b/package.json), [justbeluga repository metadata](https://api.github.com/repos/justbeluga/tiktok-web-reverse-engineering), [justbeluga tree](https://api.github.com/repos/justbeluga/tiktok-web-reverse-engineering/git/trees/cdf104fd011bc0d07ef22c954eae949014c349b8?recursive=1), [justbeluga README](https://raw.githubusercontent.com/justbeluga/tiktok-web-reverse-engineering/cdf104fd011bc0d07ef22c954eae949014c349b8/README.md), and [justbeluga DOM demo](https://raw.githubusercontent.com/justbeluga/tiktok-web-reverse-engineering/cdf104fd011bc0d07ef22c954eae949014c349b8/DOM/demo.mjs).

## Public interface shape

### bolocuixue

- CommonJS library entry: `src/tiktok-signer.cjs`; package `main` points to it.
- Public exports are `TikTokSigner`, `createSandbox`, and `defaultUserAgent`.
- `TikTokSigner` exposes `initFor(url)`, `frontierSign(url)`, and asynchronous `signUrl(url, init?)` methods. The full signing result is object-shaped and includes the unsigned URL, signed URL, and parsed output parameters.
- CLI and Python wrapper accept a URL; README JSON output is a signed-URL/result object. There is no TypeScript declaration file or stable published package API.

Operational dependencies: Node built-ins (`fs`, `path`, `vm`, encoders) and three local SDK snapshot files are required merely to initialize/sign. The signer uses a Node VM with browser stubs and reads those snapshots from disk. Separate collector commands perform network and filesystem I/O, and some historical workflows mention a browser; those are not required by the core local signer entrypoint. The package manifest also lists unpinned-major-compatible ranges for development libraries, including `vm2`, `axios`, and parsing/formatting utilities.

Sources: [package manifest](https://raw.githubusercontent.com/bolocuixue/X-Bogus_X-GnarlyDOU_K/34717ba7cb25f3803a9d954fdf05a27d6bfb765b/package.json), [signer entrypoint](https://github.com/bolocuixue/X-Bogus_X-GnarlyDOU_K/blob/34717ba7cb25f3803a9d954fdf05a27d6bfb765b/src/tiktok-signer.cjs), and [README](https://raw.githubusercontent.com/bolocuixue/X-Bogus_X-GnarlyDOU_K/34717ba7cb25f3803a9d954fdf05a27d6bfb765b/README.md).

### justbeluga

- README documents asynchronous `signParams({ params, url, body })` where `params` is an object, `url` is a TikTok base endpoint, and `body` is optional.
- The DOM demo returns `{ signedUrl, xBogus, xGnarly, userAgent }`. The underlying default-exported `Signer` class has `init()`, `navigator()`, `Sign({url, body?})`, and `close()` methods; `Sign` returns `{ signedUrl, xBogus, xGnarly }`.
- A separate non-DOM demo exports another `signParams(data)` with a different return type: a signed URL string. This conflicting surface, combined with the absence of package-root metadata and TypeScript declarations, means there is no single stable typed contract to consume.

Operational dependencies: the DOM variant imports `playwright-chromium`, launches Chromium unless a browser is injected, creates a context/page, navigates to a TikTok URL, and injects a local script. Its manifest uses ranges (`playwright-chromium ^1.54.2`, `puppeteer ^24.16.0`, `axios ^1.11.0`), so a reproducible integration would need a lockfile/commit and browser-binary handling. The non-DOM variant is local JavaScript, but exposes a different interface. No source evidence establishes a browser-free CapCut signer.

Sources: [README](https://raw.githubusercontent.com/justbeluga/tiktok-web-reverse-engineering/cdf104fd011bc0d07ef22c954eae949014c349b8/README.md), [DOM demo](https://raw.githubusercontent.com/justbeluga/tiktok-web-reverse-engineering/cdf104fd011bc0d07ef22c954eae949014c349b8/DOM/demo.mjs), [DOM signer](https://github.com/justbeluga/tiktok-web-reverse-engineering/blob/cdf104fd011bc0d07ef22c954eae949014c349b8/DOM/signer.mjs), [DOM manifest](https://raw.githubusercontent.com/justbeluga/tiktok-web-reverse-engineering/cdf104fd011bc0d07ef22c954eae949014c349b8/DOM/package.json), and [non-DOM demo](https://raw.githubusercontent.com/justbeluga/tiktok-web-reverse-engineering/cdf104fd011bc0d07ef22c954eae949014c349b8/demo.mjs).

## Licensing and supply-chain constraints

- Both GitHub repositories declare MIT licenses for their authored code.
- The bolocuixue `package.json` says `ISC`, while the repository `LICENSE` and GitHub metadata say MIT. More importantly, its `THIRD_PARTY_NOTICES.md` explicitly excludes the bundled runtime SDK snapshots from the project's MIT grant unless their rights holder permits use. Those snapshots are required by its signer, so the repository-level MIT label is not sufficient clearance for redistribution or production embedding.
- The justbeluga repository's checked-in license is MIT, but its README distinguishes free source from a paid newer runtime offering. No tag/release/package provenance ties that advertised offering to the reviewed source.
- Neither project presents a maintained semver release channel. Vendoring either reference would require commit pinning, integrity hashes, license review for every bundled asset, and an explicit update process.

Sources: [bolocuixue LICENSE](https://github.com/bolocuixue/X-Bogus_X-GnarlyDOU_K/blob/34717ba7cb25f3803a9d954fdf05a27d6bfb765b/LICENSE), [bolocuixue third-party notices](https://raw.githubusercontent.com/bolocuixue/X-Bogus_X-GnarlyDOU_K/34717ba7cb25f3803a9d954fdf05a27d6bfb765b/THIRD_PARTY_NOTICES.md), [justbeluga LICENSE](https://github.com/justbeluga/tiktok-web-reverse-engineering/blob/cdf104fd011bc0d07ef22c954eae949014c349b8/LICENSE), and the metadata/READMEs linked above.

## Compatibility gate for AutoManager

The safe reusable information is limited to outer contract design: accept a complete URL/query/body plus explicit user-agent/runtime context, return a signed URL and named output fields, and treat signing as asynchronous and fallible. Do not copy generation internals or signature values.

For CapCut trial-status checking, do not select either implementation based only on matching query names. A future adapter must be supported by fresh CapCut evidence for application ID `348188`, exact request serialization, required runtime context, accepted response behavior, and dependency/license provenance. Until then, absence of a proven CapCut signer must produce an explicit unsupported/unavailable result—never unsigned dispatch, TikTok defaults, browser fallback, or a claim that a TikTok-generated result is valid for CapCut.

Local CapCut evidence: [`headers-cookies.md`](./headers-cookies.md) records `appid=348188`; [`signing-audit.md`](./signing-audit.md) says the `X-Bogus` and `X-Gnarly` construction remains opaque; [`api-map.md`](./api-map.md) records those query names on selected CapCut task calls without proving generation.
