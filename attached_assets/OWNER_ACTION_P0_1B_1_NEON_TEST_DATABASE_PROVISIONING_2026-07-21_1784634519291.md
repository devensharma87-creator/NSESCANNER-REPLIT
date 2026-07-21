# Owner Action — P0.1B-1 Neon Test Database Provisioning

## Purpose

Create one new, empty, independently isolated Neon project for automated tests. Do not use or modify the existing Replit development database or the existing Neon production project.

Complete these steps manually. Do not paste any password, connection string, identity UUID, certificate, or secret into Replit Agent chat or ChatGPT.

## Safety rules

- Create a **new Neon project**, not a branch of the production project.
- Do not clone, restore, import, or copy any existing database.
- Do not open or modify the existing production Neon project while following these steps.
- Do not create the runner with the Neon Console's **Add role** button. Neon documents that Console/API/CLI-created roles can receive `neon_superuser` membership. Create the restricted runner with SQL instead.
- Do not overwrite Replit's `DATABASE_URL`.
- Add test secrets only in the Replit **Project Editor Secrets** pane, never in Publishing/Deployment secrets.
- Do not publish or restart the application.

## Step 1 — Create a separate Neon project

1. Open <https://console.neon.tech>.
2. From the Projects dashboard, select **New Project**.
3. Use this project name:

   `nsescanner-automated-test-20260721`

4. Choose PostgreSQL 16 if a version choice is displayed.
5. Choose the same region as the Replit application's deployment region when that region is known. If it is not shown, choose the geographically closest available region. Do not guess that Singapore or a US region is correct without checking the deployment metadata.
6. Choose the lowest-cost plan that supports the test project. Review the displayed price before confirming; do not assume a quoted price remains current.
7. Create an **empty** project.
8. Do not import, restore, clone, or branch from the production project.
9. Keep automatic suspend/scale-to-zero enabled if available.
10. Record the new project ID privately in a password manager or secure note. Do not paste it into chat.

## Step 2 — Create the dedicated database

Within the new project only:

1. Open **Branches**.
2. Select the new project's default `main` branch.
3. Open **Roles & Databases**.
4. Select **Add database**.
5. Use this database name:

   `nsescanner_test`

6. Keep the new project's administrative/default role as the database owner.
7. Confirm creation.

Do not create this database in the existing production Neon project.

## Step 3 — Generate a runner password privately

Use a password manager to generate a random password of at least 32 characters.

The password must not contain single quotes because it will be entered once in the SQL statement below. Do not reuse any application, broker, database, email, or personal password.

Keep the password private. Do not paste it into chat, source code, Git, screenshots, or documentation.

## Step 4 — Create the restricted runner through SQL

1. In the new Neon project, open **SQL Editor**.
2. Select:
   - branch: `main`;
   - database: `nsescanner_test`;
   - role: the new project's administrative/default owner role.
3. Replace only `<PASTE_PRIVATE_RANDOM_PASSWORD_HERE>` in the SQL below.
4. Run the complete block in the new test project.

```sql
BEGIN;

CREATE ROLE nsescanner_test_runner
  LOGIN
  PASSWORD '<PASTE_PRIVATE_RANDOM_PASSWORD_HERE>'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS
  NOINHERIT;

-- The runner is created through SQL so it should have no neon_superuser
-- membership. This explicit revoke is defense in depth.
REVOKE neon_superuser FROM nsescanner_test_runner;

REVOKE ALL PRIVILEGES ON DATABASE nsescanner_test FROM PUBLIC;
GRANT CONNECT, TEMPORARY, CREATE
  ON DATABASE nsescanner_test
  TO nsescanner_test_runner;

ALTER ROLE nsescanner_test_runner
  SET statement_timeout = '120s';
ALTER ROLE nsescanner_test_runner
  SET lock_timeout = '10s';
ALTER ROLE nsescanner_test_runner
  SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE nsescanner_test_runner
  SET application_name = 'nsescanner_automated_test';
ALTER ROLE nsescanner_test_runner
  SET search_path = 'pg_catalog';

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM nsescanner_test_runner;

CREATE SCHEMA test_control;
REVOKE ALL PRIVILEGES ON SCHEMA test_control FROM PUBLIC;

CREATE TABLE test_control.environment_identity (
  identity_uuid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_class text NOT NULL
    CHECK (environment_class = 'AUTOMATED_TEST_ONLY'),
  resource_label text NOT NULL,
  expected_database name NOT NULL,
  expected_role name NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version = 1),
  purpose text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO test_control.environment_identity (
  environment_class,
  resource_label,
  expected_database,
  expected_role,
  schema_version,
  purpose
) VALUES (
  'AUTOMATED_TEST_ONLY',
  'nsescanner-automated-test-20260721',
  'nsescanner_test',
  'nsescanner_test_runner',
  1,
  'Disposable isolated database for NSESCANNER automated tests only'
);

REVOKE ALL PRIVILEGES
  ON test_control.environment_identity
  FROM PUBLIC, nsescanner_test_runner;
GRANT USAGE
  ON SCHEMA test_control
  TO nsescanner_test_runner;
GRANT SELECT
  ON test_control.environment_identity
  TO nsescanner_test_runner;

COMMIT;
```

If the `REVOKE neon_superuser` statement reports that the membership does not exist, that is expected for a correctly SQL-created role. If any other statement fails, stop. Do not rerun isolated fragments without recording the error.

## Step 5 — Privilege check in Neon SQL Editor

Still connected as the new project's owner to `nsescanner_test`, run:

```sql
SELECT
  rolname,
  rolsuper,
  rolcreatedb,
  rolcreaterole,
  rolreplication,
  rolbypassrls,
  rolinherit,
  rolcanlogin
FROM pg_roles
WHERE rolname = 'nsescanner_test_runner';

SELECT parent.rolname AS inherited_role
FROM pg_auth_members membership
JOIN pg_roles child ON child.oid = membership.member
JOIN pg_roles parent ON parent.oid = membership.roleid
WHERE child.rolname = 'nsescanner_test_runner';

SELECT
  identity_uuid,
  environment_class,
  resource_label,
  expected_database,
  expected_role,
  schema_version,
  purpose,
  created_at
FROM test_control.environment_identity;
```

Expected runner flags:

- `rolsuper = false`
- `rolcreatedb = false`
- `rolcreaterole = false`
- `rolreplication = false`
- `rolbypassrls = false`
- `rolinherit = false`
- `rolcanlogin = true`

The inherited-role query must return zero rows. If it returns `neon_superuser` or any other role, stop and do not create a connection secret.

The identity query must return exactly one row. Save its full `identity_uuid` privately; do not paste it into chat.

## Step 6 — Obtain the restricted direct connection string

1. In the new test project, select **Connect**.
2. Choose:
   - branch: `main`;
   - database: `nsescanner_test`;
   - role: `nsescanner_test_runner`.
3. Disable **Connection pooling** for the first provisioning/attestation stage so the runner uses a direct endpoint.
4. Confirm the connection uses PostgreSQL port `5432` and includes Neon's required TLS parameters.
5. Copy the connection string privately.

Do not use the project-owner role's connection string. Do not paste the runner connection string into chat or a source file.

## Step 7 — Add editor-only Replit secrets

Replit keeps Project Editor development secrets separate from published deployment secrets. Add these only through the Project Editor's **Secrets** tool.

Do not open Publishing secrets for this task.

Add:

| Secret | Value |
| --- | --- |
| `TEST_DATABASE_URL` | Direct connection string for `nsescanner_test_runner` to `nsescanner_test` |
| `TEST_DB_IDENTITY_UUID` | Full UUID returned by the identity query |
| `TEST_DB_EXPECTED_DATABASE` | `nsescanner_test` |
| `TEST_DB_EXPECTED_ROLE` | `nsescanner_test_runner` |
| `TEST_DB_EXPECTED_PORT` | `5432` |
| `TEST_DB_TLS_POLICY` | The exact SSL mode in the generated Neon connection string |

Do not overwrite or edit `DATABASE_URL`.

Do not add any of these values to Publishing/Deployment secrets.

Do not create `TEST_DB_EXPECTED_HOST_FINGERPRINT` manually. Replit Coder will calculate the normalized host fingerprint without printing the host and will request permission to persist only the fingerprint if required.

## Step 8 — Owner confirmation to send back

After completing the steps, send only this non-secret confirmation to Replit Coder:

```text
P0.1B-1 owner provisioning complete.

- New independent Neon project created: YES
- Project created empty, not cloned/restored: YES
- Dedicated database nsescanner_test created: YES
- Runner created through SQL, not Console/API: YES
- Runner privilege flags all restricted: YES
- Runner has zero inherited roles: YES
- Identity marker contains exactly one AUTOMATED_TEST_ONLY row: YES
- Direct runner connection stored as Project Editor TEST_DATABASE_URL: YES
- Identity UUID stored as Project Editor secret: YES
- Expected database/role/port/TLS secrets stored: YES
- DATABASE_URL unchanged: YES
- Publishing/Deployment secrets unchanged: YES
- No credentials or UUID included in this message: YES

Continue P0.1B-1 from Stage 8 identity attestation only. Do not run migrations or tests.
```

## Stop and request help if

- the project creation screen offers only cloning/restoring an existing project;
- you are unsure whether you are inside the new test project or production project;
- the database or runner name already exists unexpectedly;
- any SQL statement other than the defensive membership revoke fails;
- the runner inherits `neon_superuser` or another role;
- the identity table does not contain exactly one row;
- the Connect dialog cannot select `nsescanner_test_runner` and `nsescanner_test`;
- the generated connection does not require TLS;
- Replit asks you to add these values to Publishing secrets;
- you accidentally expose a credential in chat or a screenshot.

Do not proceed by guessing.

## Reference documentation

- Neon role management: <https://neon.com/docs/manage/roles>
- Neon least-privilege database access: <https://neon.com/docs/manage/database-access>
- Neon database creation: <https://neon.com/docs/manage/databases>
- Neon connection selection: <https://neon.com/docs/connect/connect-from-any-app>
- Replit development vs production secrets: <https://docs.replit.com/help/deployment-and-publishing>
