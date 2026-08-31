import {
  January, JanuaryApiError, JanuaryConfigurationError, JanuaryValidationError, JanuaryTransportError,
} from '@january-ai/server';

async function main() {
  const secretKey = process.env.JANUARY_API_KEY?.trim();
  if (!secretKey?.trim()) {
    console.error('Set JANUARY_API_KEY in your .env file before running.');
    process.exitCode = 2;
    return;
  }

  const january = new January({
    secretKey,
  });
  // In your application, use the ID from your authenticated server session.
  const user = january.forUser({
    endUserId: 'january-quickstart',
    endUserTimezone: 'UTC',
  });
  const foods = await user.foods.search({ query: 'banana' });
  console.log(`Found ${foods.items.length} foods in this response.`);
  console.log(foods.items[0] ? `First food: ${foods.items[0].name}` : 'No foods found.');
}

try {
  await main();
} catch (error) {
  // SDK error metadata is credential-redacted; JSON escapes control characters.
  // Never print the raw error, message, headers, or response body.
  if (error instanceof JanuaryApiError) {
    console.error(JSON.stringify({
      status: error.status, code: error.code, requestId: error.requestId,
    }));
    if (error.status === 401) {
      console.error('Check your server API key in https://dashboard.january.ai/dashboard.');
    } else if (error.status === 403) {
      console.error('Check account permissions with support@january.ai. Client tokens are not required for this search.');
    } else if (error.code === 'credit_limit_exceeded') {
      console.error('Check your credit balance and plan in https://dashboard.january.ai/billing.');
    } else if (error.status === 429) {
      console.error('Rate limit reached. Respect Retry-After before retrying this read.');
    } else {
      console.error('Food search failed. Contact support@january.ai with these diagnostic fields.');
    }
  } else if (error instanceof JanuaryConfigurationError) {
    console.error('Check JANUARY_API_KEY (server key, not ct- client token).');
  } else if (error instanceof JanuaryValidationError) {
    console.error('Invalid request input. Check the method parameters; no API request was sent.');
  } else if (error instanceof JanuaryTransportError) {
    console.error(`Transport failure: ${error.code}. Check your connection or timeout.`);
  } else {
    console.error('Food search failed. Check the README troubleshooting section.');
  }
  process.exitCode = 1;
}
