# Split App Database Architecture - Quick Reference

## Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                     HUMAN-CENTRIC CORE                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────┐         ┌──────────────────┐                  │
│  │    HUMANS        │◄────────│  EMAIL_HISTORY   │                  │
│  │                  │         │  (Temporal)      │                  │
│  │ id (PK)          │         │                  │                  │
│  │ first_name       │         │ human_id (FK)    │                  │
│  │ last_name        │         │ email            │                  │
│  │ dob              │         │ effective_from   │                  │
│  │ gender           │         │ effective_to     │                  │
│  │ phone            │         │                  │                  │
│  │ created_at       │         └──────────────────┘                  │
│  │ updated_at       │                                               │
│  └────┬─────────────┘                                               │
│       │                                                    n        │
│       │ 1:1                                                         │
│       ├─────────┬──────────────┬──────────────────┐                 │
│       │         │              │                  │                 │
│  ┌────▼────┐ ┌──▼──────┐ ┌─────▼────┐ ┌──────────▼──┐               │
│  │CUSTOMERS│ │ PAYERS  │ │ PAYEES   │ │    OTHER    │               │
│  │         │ │         │ │          │ │   ROLES     │               │
│  │ human_id│ │human_id │ │human_id  │ │             │               │
│  │username │ │username │ │username  │ │             │               │
│  │password │ │         │ │          │ │             │               │
│  │loyalty_ │ │         │ │          │ │             │               │
│  │ points  │ │         │ │          │ │             │               │
│  └────────┘ └─────────┘ └──────────┘ └─────────────┘                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    ROLE-BASED ACCESS CONTROL                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────┐                  ┌──────────────────┐         │
│  │  SITE_ROLES      │                  │  PERMISSIONS     │         │
│  │                  │                  │                  │         │
│  │ id (PK)          │                  │ id (PK)          │         │
│  │ role_name        │ ◄────junction───► │ permission_name  │         │
│  │ description      │   (many:many)    │ resource         │         │
│  │ is_active        │                  │ action           │         │
│  │ created_at       │                  │ is_active        │         │
│  └────┬─────────────┘                  └──────────────────┘         │
│       │                                                             │
│       │ junction: SITE_ROLE_PERMISSIONS                             │
│       │                                                             │
│       │ junction: HUMAN_SITE_ROLES                                  │
│       │                                                             │
│       └───────────────────┬───────────────────────────────────────┐ │
│                           │                                       │ │
│                    Can have many roles                        Many:Many│
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    DOMAIN ENTITIES (Unchanged)                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  EVENTS ◄──────── ACTIVITIES ◄────── EXPENSES ◄──── EXPENSE_SPLITS  │
│                                           │                         │
│  creator_id ──┐                           │                         │
│  (humans.id)  |            ┌──────────────┼──────┐                  │
│               |            |              |      |                  │
│               └────────────┼──────────────┼──────┼──────────┐       │
│                GROUP_MEMBERS               |      |         |       │
│                (many humans)        paid_by|   group_id   user_id   │
│                               (humans.id) │    (groups)   (humans)  │
│                                           │                         │
│                                    ┌──────┴──────┐                  │
│                                    EXPENSE_GROUPS                   │
│                                    created_by                       │
│                                    (humans.id)                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Examples

### Example 1: User Registration → Creates Human + Customer + Email Record

```
Flow:
  1. Form submit: email, username, password
  2. Create humans row (empty first_name, etc.)
  3. Create email_history row (human_id, email, effective_from=now)
  4. Create customers row (human_id, username, password_hash)
  5. Assign customer role via human_site_roles

SQL (automatic from app):
  BEGIN;
    INSERT INTO humans (id, ...) RETURNING id;
    INSERT INTO email_history (human_id, email, effective_from) VALUES (...);
    INSERT INTO customers (human_id, username, password_hash) VALUES (...);
    COMMIT;
```

### Example 2: User Changes Email → Creates New Email History Entry

```
Before:
  email_history: { human_id, email='old@example.com', effective_from, effective_to=NULL }

Change:
  UPDATE email_history SET effective_to=now() WHERE human_id=? AND effective_to IS NULL;
  INSERT INTO email_history (human_id, email='new@example.com', effective_from=now());

After:
  email_history: [
    { human_id, email='old@example.com', effective_from='2026-01-01', effective_to='2026-04-02' },
    { human_id, email='new@example.com', effective_from='2026-04-02', effective_to=NULL }
  ]

Query current email:
  SELECT email FROM email_history
  WHERE human_id=? AND effective_to IS NULL;
```

### Example 3: Admin Creates Event with Expense Split

```
Participants:
  - Human A (admin, payer)
  - Human B (customer, payor)
  - Human C (customer, payee)

Process:
  1. Create event (creator_id = Human A's id)
  2. Create activity (event_id)
  3. Create expense (paid_by = Human B's id, amount=90)
  4. Create expense_splits:
     - split for Human B: 30 (they paid, owe 30)
     - split for Human C: 60 (owe 60)

Questions answered:
  - Who created event? SELECT creators.first_name FROM humans WHERE id = events.creator_id
  - Who paid? SELECT customer.username FROM customers WHERE human_id = expenses.paid_by
  - Who owes what? SELECT humans.first_name, expense_splits.amount FROM ...
```

---

## Common Query Patterns

### Pattern 1: Get Human with Current Email

```typescript
const query = db
  .select()
  .from(humans)
  .leftJoin(
    emailHistory,
    and(
      eq(humans.id, emailHistory.humanId),
      isNull(emailHistory.effectiveTo) // Current email only
    )
  );
```

### Pattern 2: Check User Permission

```typescript
const hasPermission = db
  .select({ allowed: sql`true` })
  .from(humans)
  .innerJoin(humanSiteRoles, eq(humans.id, humanSiteRoles.humanId))
  .innerJoin(siteRoles, eq(humanSiteRoles.siteRoleId, siteRoles.id))
  .innerJoin(siteRolePermissions, eq(siteRoles.id, siteRolePermissions.siteRoleId))
  .innerJoin(permissions, eq(siteRolePermissions.permissionId, permissions.id))
  .where(and(eq(humans.id, someHumanId), eq(permissions.permissionName, 'events.create')));
```

### Pattern 3: Get All Humans with a Role

```typescript
const query = db
  .select({ human: humans, roleName: siteRoles.roleName })
  .from(humans)
  .innerJoin(humanSiteRoles, eq(humans.id, humanSiteRoles.humanId))
  .innerJoin(siteRoles, eq(humanSiteRoles.siteRoleId, siteRoles.id))
  .where(eq(siteRoles.roleName, 'admin'));
```

### Pattern 4: Get Email History for a Human

```typescript
const history = db
  .select()
  .from(emailHistory)
  .where(eq(emailHistory.humanId, someHumanId))
  .orderBy(desc(emailHistory.effectiveFrom));

// Shows:
// [
//   { email: 'new@example.com', effective_from: '2026-04-02', effective_to: null },
//   { email: 'old@example.com', effective_from: '2026-01-01', effective_to: '2026-04-02' },
// ]
```

---

## Default Roles & Permissions Matrix

| Role          | Description        | Permissions                                                                                        |
| ------------- | ------------------ | -------------------------------------------------------------------------------------------------- |
| **admin**     | Full system access | `*` (all 13)                                                                                       |
| **customer**  | Regular user       | `events.view`, `events.create`, `expenses.view`, `expenses.create`, `groups.view`, `groups.create` |
| **organizer** | Event organizer    | `events.*`, `activities.*`, `groups.manage`                                                        |
| **payer**     | Pays expenses      | `expenses.create`, `expenses.edit`, `expenses.view`                                                |
| **payee**     | Receives payments  | `expenses.view`                                                                                    |

---

## Migration Steps Checklist

- [ ] **Step 1**: Run migration SQL (`001-0.1.0-human-centric-schema.sql`)
- [ ] **Step 2**: Test data migration (`SELECT COUNT(*) FROM humans;`)
- [ ] **Step 3**: Update `src/db/index.ts` to import new schema
- [ ] **Step 4**: Create helper functions in `src/db/queries.ts`
- [ ] **Step 5**: Update auth endpoints (register/login)
- [ ] **Step 6**: Test registration in dev environment
- [ ] **Step 7**: Update dashboard endpoints
- [ ] **Step 8**: Test full auth flow
- [ ] **Step 9**: Document in project `README.md`
- [ ] **Step 10**: Ready for Phase 2!

---

## Schema Validation Queries

### Verify Migration Completed

```sql
-- All existing users migrated to humans
SELECT COUNT(*) as human_count FROM humans;

-- Email history populated
SELECT COUNT(*) as email_count FROM email_history;

-- Customers created
SELECT COUNT(*) as customer_count FROM customers;

-- Default 5 roles exist
SELECT COUNT(*) as role_count FROM site_roles;

-- 13 default permissions
SELECT COUNT(*) as perm_count FROM permissions;

-- Permissions assigned to roles
SELECT COUNT(*) as assignment_count FROM site_role_permissions;
```

### Verify No Data Loss

```sql
-- Compare old vs new counts
SELECT
  (SELECT COUNT(*) FROM users) as old_user_count,
  (SELECT COUNT(*) FROM humans) as new_human_count;

-- Should be equal (all users migrated)
```

---

## Files Created/Modified

### New Files

- ✅ `migrations/001-0.1.0-human-centric-schema.sql` - SQL migration
- ✅ `src/db/human-centric-schema.ts` - Drizzle ORM definitions
- ✅ `DATABASE_MIGRATION_GUIDE.md` - Detailed guide
- ✅ `DATABASE_ARCHITECTURE.md` - This file

### Files to Update Later

- `src/db/index.ts` - Import new schema
- `src/db/queries.ts` - Add helper functions
- `src/pages/api/auth/register.ts` - Use new schema
- `src/pages/api/auth/login.ts` - Use new schema
- `src/pages/dashboard.astro` - Use new schema

---

## Next Steps

1. **This Session**: Understand the architecture ✓
2. **Next Step**: Run the migration SQL
3. **Then**: Update code endpoints one by one
4. **Finally**: Build Phase 2 features on new foundation

---

**Questions?** See `DATABASE_MIGRATION_GUIDE.md` for detailed explanations.
