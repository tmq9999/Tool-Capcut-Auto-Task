# CapCut HTTP Request Inventory (Captured UI Run)

Capture source: app-owned file `C:\Users\tranm\AppData\Roaming\automanager-desktop\captures\50e455ed-7902-4353-9aee-043603d7c6d9.ndjson` (redacted recorder v2, headed, one account, 12/12 task result). This document records observed shapes; it does not authorize replay.

## Confirmed task endpoints

| Operation | Observed contract | Evidence |
| --- | --- | --- |
| Task list | `POST edit-api-sg.capcut.com/luckycat/.../capcut/task/v1/task_list` with JSON `scene` field | Multiple fresh responses; parsed by existing TaskStore |
| Leaf acknowledgement | `POST .../task/v1/do_action` with `action_key` and `op_id`; response `err_no` | 9 observed request/response pairs; passive proof only |

The recorder redacts dynamic path segments and values. The exact campaign prefix, signed query values and headers must be recovered from an authorized contract fixture before direct HTTP use.

## Confirmed Design/Canvas endpoints

| Stage | Observed request family | Notes |
| --- | --- | --- |
| Workspace save | `POST edit-api-sg.capcut.com/lv/v2/canvas/save` | Empty draft save precedes upload; later body contains workspace, draft, material/resource and commit relationships |
| Upload signing | `POST edit-api-sg.capcut.com/lv/v2/intelligence/file/chat_upload_sign` and `POST .../lv/v2/canvas/upload_sign` | Returns data required for object-storage upload; body shapes are capture-specific |
| Object upload | `POST .../upload/v1/tos-alisg-i-ccagentfilethread-sg/...` and `...ccwebcanvascover-sg/...` | Binary bodies intentionally omitted; direct replay requires a separate upload contract |
| Task list refresh | Same task-list endpoint after chat/upload/canvas stages | Fresh status must confirm completion |

## Confirmed AI/query endpoints

- `POST edit-api-sg.capcut.com/lv/v1/effect/genai/task/query` observed during Design/Creator page setup and generation state reads.
- `POST edit-api-sg.capcut.com/cc/v1/workspace/*` observed for workspace discovery and membership.
- `POST edit-api-sg.capcut.com/storyboard_agent/v1/ai_lab/*` observed for AI workspace setup/list/model metadata.

These are not yet operation contracts: the capture contains many setup calls and does not isolate the exact mutation request for each UI click with a complete causal job chain.

## Not Yet Captured/Promoted

- Inspiration submit mutation with its exact prompt/template payload.
- Design chat submit mutation separate from workspace save/setup.
- Canvas edit mutation separate from draft save.
- AI Creator generation submission, job polling correlation, and export/download mutation as a complete chain.
- Auth/session bootstrap suitable for direct Node HTTP; current capture depends on browser-owned cookies/signatures.

## Promotion Rule

Only entries with complete request/response schemas, dependency IDs, auth requirements, idempotency/ambiguity behavior, and fixture tests may move from `captured` to `fixture-verified`. Until then, the corresponding UI operation remains the only live writer.
