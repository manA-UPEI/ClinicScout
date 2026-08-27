import { test } from "node:test";
import assert from "node:assert/strict";
import { isAuthConfigured, readConfiguredAuthProviders } from "./authProviders.ts";

/** Runs `fn` with `vars` applied to process.env, restoring whatever was there before. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const NONE = {
  AUTH_SECRET: undefined,
  AUTH_GITHUB_ID: undefined,
  AUTH_GITHUB_SECRET: undefined,
  AUTH_GOOGLE_ID: undefined,
  AUTH_GOOGLE_SECRET: undefined,
};

test("reports no providers when nothing is configured", () => {
  withEnv(NONE, () => {
    assert.deepEqual(readConfiguredAuthProviders(), []);
  });
});

test("reports only the provider whose credentials are both set", () => {
  withEnv({ ...NONE, AUTH_GITHUB_ID: "id", AUTH_GITHUB_SECRET: "secret" }, () => {
    assert.deepEqual(readConfiguredAuthProviders(), ["github"]);
  });
});

test("ignores a provider with an id but no secret", () => {
  withEnv({ ...NONE, AUTH_GOOGLE_ID: "id" }, () => {
    assert.deepEqual(readConfiguredAuthProviders(), []);
  });
});

test("reports both providers when both are configured", () => {
  withEnv(
    {
      ...NONE,
      AUTH_GITHUB_ID: "id",
      AUTH_GITHUB_SECRET: "secret",
      AUTH_GOOGLE_ID: "id",
      AUTH_GOOGLE_SECRET: "secret",
    },
    () => {
      assert.deepEqual(readConfiguredAuthProviders(), ["github", "google"]);
    }
  );
});

test("is not configured when a provider is set up but the secret is missing", () => {
  withEnv({ ...NONE, AUTH_GITHUB_ID: "id", AUTH_GITHUB_SECRET: "secret" }, () => {
    assert.equal(isAuthConfigured(), false);
  });
});

test("is not configured when the secret is set but no provider is", () => {
  withEnv({ ...NONE, AUTH_SECRET: "s" }, () => {
    assert.equal(isAuthConfigured(), false);
  });
});

test("is configured when a secret and at least one provider are both present", () => {
  withEnv(
    { ...NONE, AUTH_SECRET: "s", AUTH_GITHUB_ID: "id", AUTH_GITHUB_SECRET: "secret" },
    () => {
      assert.equal(isAuthConfigured(), true);
    }
  );
});
