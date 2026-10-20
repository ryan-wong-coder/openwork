# Native AI personal-tool validation

On 2026-10-20 both native engines completed actual ModelHelm calls using
GPT 6.1 and the production personal tool/schema compiled from the working
source. Each lane first passed its own native synthetic preflight.

| Lane | Native engine | Synthetic requests | Actual model requests | Actual HTTP results |
| --- | --- | ---: | ---: | --- |
| V1 | 1.18.30 | 5 | 6 | 6 × 200 |
| V2 | 2.0.26 | 5 | 6 | 6 × 200 |

The actual model called `zeno_personal` to read fixture data, create a synthetic
calendar event, then undo it using the returned undo handle. The event reached
version 2 with a tombstone. A second conversation ran in scheduled mode and
actually called `propose`, creating a pending scheduled proposal while leaving
calendar records unchanged. The controller made zero business mutations.

Each lane had an enforced maximum of 8 upstream requests and 1536 output tokens
per request, checked before forwarding. No further model calls were made after
the two successful lanes.

Evidence:

- [V1 synthetic preflight](ai-personal-native-v1-synthetic.json)
- [V1 actual model run](ai-personal-native-v1-live.json)
- [V2 synthetic preflight](ai-personal-native-v2-synthetic.json)
- [V2 actual model run](ai-personal-native-v2-live.json)

The native sidecars ran headlessly with separate temporary home, configuration,
cache and databases, with native network access limited to loopback. The host
proxy allowed only the configured ModelHelm route. The existing upstream key
stayed in host memory; native configuration received only a process-scoped proxy
credential. The temporary native profiles were checked for the upstream key and
removed, and raw answers, thinking and native logs were discarded. Reports
contain only allowlisted action types, outcomes, counts and scope metadata.

The data backend was an isolated in-memory fixture using the production
`createZenoPersonalToolsService`, shared record schemas and native plugin bridge.
These results prove actual model tool execution, rather than controller-written
receipts. They do not prove a deployed account, SQLite synchronization, operating
system credential storage, desktop UI, timer admission, packaged installation or
upgrade. Those have separate tests and acceptance gates. Synthetic responses
are explicitly marked and are not evidence of actual model behavior.
