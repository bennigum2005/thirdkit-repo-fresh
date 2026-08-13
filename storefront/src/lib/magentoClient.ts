// src/lib/magentoClient.ts — server only (course ch. 3 & 4).
// One shared GraphQL client. Importing this from a client component fails the
// build instead of leaking the endpoint/token to the browser.
import "server-only";
import { GraphQLClient } from "graphql-request";
import { fetchWithProtection } from "./fetchWithProtection";

const endpoint = process.env.MAGENTO_GRAPHQL_ENDPOINT;

if (!endpoint) {
  // Fail loudly at first use, not silently with wrong data.
  console.warn("MAGENTO_GRAPHQL_ENDPOINT is not set — see .env.local.example");
}

export function magentoClient(customerToken?: string): GraphQLClient {
  return new GraphQLClient(endpoint ?? "http://magento-endpoint-not-configured", {
    headers: {
      ...(process.env.MAGENTO_STORE_CODE ? { Store: process.env.MAGENTO_STORE_CODE } : {}),
      ...(customerToken ? { Authorization: `Bearer ${customerToken}` } : {}),
    },
    fetch: fetchWithProtection,
  });
}
