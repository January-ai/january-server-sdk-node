# Photos, retries and errors

## Prepare a local photo (Node.js)

```sh
npm install @january-ai/server sharp
```

```ts
import { prepareImage } from '@january-ai/server/images';

const image = await prepareImage('./lunch.jpg');
const result = await user.foodAnalysis.analyzePhoto({ image });
```

The photo helper accepts public HTTP(S) URLs, base64 data URIs, trusted file paths,
`Buffer`/`Uint8Array`, `ArrayBuffer`, `Blob`, and binary async-iterable streams.
Do not accept untrusted user strings as local paths: use upload bytes instead.
Streams are consumed from their current position. The `sharp` peer is required
only for local image preparation, not for the core SDK or URL/data-URI forwarding.
The `/images` entry point is Node-only; Workers can send a public URL or already
prepared data URI through the main SDK without Node filesystem/native dependencies.

JPEG, PNG, WEBP and still GIF are preserved if already compliant. Local images
are decoded and checked; animated images are rejected. Preprocessing rotates EXIF,
fits within 1024 pixels without upscaling, flattens alpha onto white when needed,
and produces JPEG under 3.5 MB. Re-encoding strips metadata; pass-through bytes
retain it. Decode limits are 40 million pixels and 64 MiB of input. Codec support
for HEIC/HEIF/AVIF depends on the sharp/libvips build; convert unsupported input
to JPEG/PNG first. `{preprocess:false}` skips conversion for known-compliant bytes.
URLs/data URIs are always unchanged; January must be able to download public URLs.

## Handle specific failures

```ts
import { CreditLimitExceededError, RateLimitError, JanuaryApiError, JanuaryResponseError } from '@january-ai/server';

try {
  await user.foods.search({ query: 'banana' });
} catch (error) {
  if (error instanceof CreditLimitExceededError) {
    // Check the organization's billing allowance. Retrying cannot restore credits.
  } else if (error instanceof RateLimitError) {
    // Retries were exhausted, disabled, or could not fit the deadline.
  } else if (error instanceof JanuaryResponseError) {
    // A success response could not be decoded; this is not an HTTP status failure.
  } else if (error instanceof JanuaryApiError) {
    console.error({status:error.status,code:error.code,requestId:error.requestId});
  } else {
    throw error;
  }
}
```

Also exported: `BadRequestError`, `AuthenticationError`, `PermissionDeniedError`,
`NotFoundError`, `PayloadTooLargeError`, `InternalServerError`, and common
`JanuaryError`. Specific API errors remain `instanceof JanuaryApiError`.
Messages are bounded; `body` is redacted diagnostic text. Never log arbitrary
response data. Only rate/credit codes override HTTP classification, matching Python.

## Retries and deadlines

Two retries are enabled by default. Set `maxRetries:0` on the client or a call
to disable them. Known permanent API codes override status; unknown codes fall back
to 429/500/502/503/504. Credit exhaustion is never retried. `Retry-After` accepts
seconds or HTTP dates and is limited to 60 seconds per wait and total requested
waiting. Excessive waits return immediately with `retryNote`; cancellation
interrupts waiting. The deadline includes all attempts and body reading.

Revocation is never retried. Token and food-log creation are not replayed after
ambiguous failures. Analysis/read retries may consume extra credits. Default
timeout is 30 seconds, or 120 for photo/description analysis and correction.
Quickstart and production E2E runners explicitly disable retries.

## Checks

`npm test` exercises all 18 operations, photos, errors/retries, portion utilities,
and examples. `npm run test:distribution` installs the packed ESM/CommonJS SDK and
runs real loopback HTTP consumers. `npm run demo` starts the offline example flow.
These checks are not production API tests. `npm run test:e2e` is the separate,
billable production runner, configured only with `JANUARY_API_KEY` in `.env`.
