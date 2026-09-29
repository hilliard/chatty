# Split App: Human-Centric Database Migration Guide

## Overview

This guide walks through migrating your Split expense app from a simple **user-centric design** to a sophisticated **human-centric architecture** that supports multiple roles, temporal tracking, and granular permissions.

---

## Why Migrate?

### Current Limitations (User-Centric Model)

- ❌ Cannot track email changes over time
- ❌ No support for multiple roles per person (admin, organizer, payer, payee)
- ❌ No granular permission system
- ❌ All user metadata lumped into one table
- ❌ Difficult to extend for future features (employees, vendors, etc.)

### New Benefits (Human-Centric Model)

- ✅ Single source of truth for people (`humans` table)
- ✅ Multiple role support (customer, admin, organizer, payer, payee)
- ✅ Email history tracking (compliance, audit trails)
- ✅ Role-based access control (RBAC) with permissions
- ✅ Scalable for Phase 2+ features (events, activities, expense groups)
- ✅ Easily add new roles without schema changes
- ✅ Better data integrity with temporal tracking

---

## Architecture Comparison

### OLD STRUCTURE (Current)

```
Database
├── users (auth + profile)
│   ├── id, email, username, password_hash
│   ├── created_at, updated_at
│   └── (everything in one table)
├── ...other tables
```

**Problem**: All user data conflated. No temporal tracking. No roles.

---

### NEW STRUCTURE (Target)

```
Database
├── humans (base entity - the person)
│   ├── id, first_name, last_name, dob, gender, phone
│   └── created_at, updated_at
│
├── email_history (temporal - track all emails)
│   ├── human_id → humans.id
│   ├── email, effective_from, effective_to
│   └── (audit trail for compliance)
│
├── customers (role - auth credential)
│   ├── human_id → humans.id
│   ├── username (unique), password_hash
│   └── loyalty_points
│
├── payers / payees (roles - expense tracking)
│   ├── human_id → humans.id
│   └── username
│
├── site_roles (RBAC - define roles)
│   ├── id, role_name, description
│   └── (admin, organizer, customer, etc.)
│
├── permissions (RBAC - define actions)
│   ├── id, permission_name, resource, action
│   └── (users.manage, events.create, etc.)
│
├── human_site_roles (junction - humans ↔ roles)
│   ├── human_id, site_role_id
│   └── (one person can have many roles)
│
├── site_role_permissions (junction - roles ↔ permissions)
│   ├── site_role_id, permission_id
│   └── (each role has assigned permissions)
│
└── ...other domain tables (unchanged)
    ├── events
    ├── activities
    ├── expenses
    └── expense_groups
```

**Benefits**: Separation of concerns. Temporal tracking. Flexible roles.

---

## The activities table needs to be updated

## Migration Phases

### Time Estimate: 2-3 hours setup + gradual code migration

#### Phase 1: Deploy New Schema (5-10 min) ✓ IMMEDIATE

Create new tables in parallel with old `users` table.

- New tables created
- Old tables remain untouched
- **Zero downtime** - app keeps running

**Action**: Run the migration SQL file

```bash
# From Supabase dashboard or CLI
psql -U postgres -d postgres -f migrations/001-0.1.0-human-centric-schema.sql
```

#### Phase 2: Migrate Existing Data (5-10 min) ✓ IMMEDIATE

Move data from `users` → `humans` + `customers` + `email_history`

- Existing users become humans
- Auth data becomes customers
- Email gets tracked in email_history
- Roles assigned (default: "customer" role)

#### Phase 3: Update Code Gradually (1-2 hours) ✓ THIS WEEK

Migrate one endpoint at a time (no rush):

1. Auth endpoints (register, login) → use customers/humans
2. Dashboard endpoints → fetch from humans
3. Event/expense endpoints → reference humans
4. Permission checks → use RBAC system

#### Phase 4: Deprecate Old Table (optional) ✓ LATER

Once all code migrated:

- Can drop old `users` table
- Now running pure human-centric model

#### Phase 5: Phase 2 Features ✓ NEXT SPRINT

All Phase 2 code will use the new structure from day 1.

---

## Step 1: Run the Migration

### Option A: Using psql (Local or Remote VPS)

1. Connect to your target database (local or remote VPS)
2. Run the migration SQL file
3. Expected result: ✅ All new tables created + data migrated

### Option B: Using CLI

```bash
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -f migrations/001-0.1.0-human-centric-schema.sql
```

### Verify Success

```sql
-- Check humans table has data
SELECT COUNT(*) FROM humans;
-- Should show existing users count

-- Check email_history populated
SELECT COUNT(*) FROM email_history;
-- Should show one entry per existing user

-- Check customers created
SELECT COUNT(*) FROM customers;
-- Should match users count

-- Check roles exist
SELECT * FROM site_roles;
-- Should show: admin, customer, organizer, payer, payee

-- Check permissions created
SELECT COUNT(*) FROM permissions;
-- Should show 13 default permissions
```

---

## Step 2: Update Drizzle ORM Configuration

### Current File: `src/db/index.ts`

Update to import both old and new schemas:

```typescript
// src/db/index.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

// OLD SCHEMA (temporarily keep for backward compatibility)
import * as oldSchema from './schema';

// NEW SCHEMA (human-centric)
import * as newSchema from './human-centric-schema';

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle({
  client,
  schema: {
    ...oldSchema, // Keep old tables available
    ...newSchema, // Add new tables
  },
});

client
  .connect()
  .then(() => console.log('✓ Database connected'))
  .catch((err) => console.error('⚠ Connection error:', err.message));

export default db;
```

---

## Step 3: Create Helper Functions

### File: `src/db/queries.ts` (NEW)

```typescript
// For authenticating users against the new schema
import { eq } from 'drizzle-orm';
import type { humans, customers, emailHistory } from './human-centric-schema';

// Get human by email (searches email_history for current email)
export async function getHumanByEmail(email: string) {
  const result = await db
    .select({
      human: humans,
      customer: customers,
      email: emailHistory.email,
    })
    .from(emailHistory)
    .innerJoin(humans, eq(emailHistory.humanId, humans.id))
    .leftJoin(customers, eq(humans.id, customers.humanId))
    .where(
      and(
        eq(emailHistory.email, email),
        isNull(emailHistory.effectiveTo) // Get current email only
      )
    )
    .limit(1);

  return result[0] || null;
}

// Get human with all roles
export async function getHumanWithRoles(humanId: string) {
  const result = await db
    .select({
      human: humans,
      roles: sql<string[]>`
        array_agg(${siteRoles.roleName})
      `,
    })
    .from(humans)
    .leftJoin(humanSiteRoles, eq(humans.id, humanSiteRoles.humanId))
    .leftJoin(siteRoles, eq(humanSiteRoles.siteRoleId, siteRoles.id))
    .where(eq(humans.id, humanId))
    .groupBy(humans.id);

  return result[0] || null;
}

// Check if human has permission
export async function hasPermission(humanId: string, permissionName: string): Promise<boolean> {
  const result = await db
    .select({ exists: sql<number>`count(*)::int` })
    .from(humans)
    .innerJoin(humanSiteRoles, eq(humans.id, humanSiteRoles.humanId))
    .innerJoin(siteRoles, eq(humanSiteRoles.siteRoleId, siteRoles.id))
    .innerJoin(siteRolePermissions, eq(siteRoles.id, siteRolePermissions.siteRoleId))
    .innerJoin(permissions, eq(siteRolePermissions.permissionId, permissions.id))
    .where(and(eq(humans.id, humanId), eq(permissions.permissionName, permissionName)));

  return (result[0]?.exists ?? 0) > 0;
}
```

---

## Step 4: Gradual Code Migration

### Example 1: Update Registration Endpoint

**BEFORE** (current `src/pages/api/auth/register.ts`):

```typescript
// Uses: users table
const existingUser = await db.select().from(users).where(eq(users.email, email));
```

**AFTER** (Phase 1 - keep both working):

```typescript
// Check both old and new schemas during transition
const fromNewSchema = await getHumanByEmail(email);
const fromOldSchema = await db.select().from(users).where(eq(users.email, email));

const exists = fromNewSchema || fromOldSchema;
```

**FULLY MIGRATED** (Phase 2+):

```typescript
// Use only new schema
const human = await getHumanByEmail(email);
const exists = human !== null;
```

---

## Step 5: Testing the Migration

### Test Script: `test-migration.ts`

```typescript
import { db } from './src/db';
import * as tables from './src/db/human-centric-schema';
import { eq } from 'drizzle-orm';

async function testMigration() {
  console.log('🧪 Testing schema migration...\n');

  // Test 1: Humans table has data
  const humanCount = await db.select().from(tables.humans).limit(1);
  console.log(`✅ Humans table:`, humanCount.length > 0 ? 'OK' : 'EMPTY');

  // Test 2: Email history populated
  const emailCount = await db.select().from(tables.emailHistory).limit(1);
  console.log(`✅ Email history:`, emailCount.length > 0 ? 'OK' : 'EMPTY');

  // Test 3: Customers migrated
  const customerCount = await db.select().from(tables.customers).limit(1);
  console.log(`✅ Customers:`, customerCount.length > 0 ? 'OK' : 'EMPTY');

  // Test 4: Default roles created
  const roles = await db.select().from(tables.siteRoles);
  console.log(`✅ Roles:`, roles.length === 5 ? 'All 5 created' : `${roles.length} roles`);

  // Test 5: Permissions created
  const perms = await db.select().from(tables.permissions);
  console.log(`✅ Permissions:`, perms.length === 13 ? 'All 13 created' : `${perms.length} perms`);

  console.log('\n🎉 Migration successful!');
}

testMigration().catch(console.error);
```

Run with:

```bash
npx tsx test-migration.ts
```

---

## Role & Permission System

### Default Roles

| Role          | Usage                    | Permissions                          |
| ------------- | ------------------------ | ------------------------------------ |
| **admin**     | System administrators    | All (13 permissions)                 |
| **customer**  | Regular users            | view/create events, expenses, groups |
| **organizer** | Event creators           | all event operations                 |
| **payer**     | Users who pay expenses   | create/edit expenses                 |
| **payee**     | Users receiving payments | view expenses                        |

### Default Permissions

```
users.manage, users.view
events.create, events.edit, events.delete, events.view
expenses.create, expenses.edit, expenses.delete, expenses.view
groups.create, groups.manage, groups.view
```

### Assign a User to a Role

```typescript
// Make a human an admin
await db.insert(humanSiteRoles).values({
  humanId: someHumanId,
  siteRoleId: (await db.select().from(siteRoles).where(eq(siteRoles.roleName, 'admin')))[0].id,
  assignedBy: currentUserHumanId,
});
```

---

## Event / Activity table updates

## 1. Tables & Fields

### `events` (The Core Record)

Stores universal data applicable to all events. Specific, unstructured data (like a movie's runtime or a wedding's dress code) is stored in the `metadata` JSONB column.

| Field Name    | Data Type   | Description                                                   |
| :------------ | :---------- | :------------------------------------------------------------ |
| `id`          | UUID (PK)   | Unique identifier for the event.                              |
| `title`       | String      | e.g., "Concert at Cervantes'", "Smith Wedding".               |
| `description` | Text        | Long-form details.                                            |
| `type`        | String/Enum | `concert`, `formal_dinner`, `sports`, `movie`.                |
| `status`      | String/Enum | `scheduled`, `ongoing`, `canceled`, `completed`.              |
| `start_time`  | TIMESTAMPTZ | Exact start time (UTC).                                       |
| `end_time`    | TIMESTAMPTZ | Exact end time (UTC).                                         |
| `timezone`    | String      | Local timezone (e.g., `America/Denver`).                      |
| `is_virtual`  | Boolean     | `true` for streams, `false` for in-person.                    |
| `venue_id`    | UUID (FK)   | Links to a physical `venues` table (nullable).                |
| `group_id`    | UUID (FK)   | Optional group link; can be assigned at create time or later. |
| `is_public`   | Boolean     | Public vs. private invite-only.                               |
| `metadata`    | JSONB       | Key-value pairs specific to the event type.                   |

### `activities` (The Itinerary)

Defines the chronological timeline of the event. Bound by time.

| Field Name       | Data Type   | Description                                               |
| :--------------- | :---------- | :-------------------------------------------------------- |
| `id`             | UUID (PK)   | Unique identifier.                                        |
| `event_id`       | UUID (FK)   | Parent event.                                             |
| `title`          | String      | e.g., "Pre-show Dinner", "Drive & Park".                  |
| `start_time`     | TIMESTAMPTZ | Start of the activity.                                    |
| `end_time`       | TIMESTAMPTZ | End of the activity.                                      |
| `location_name`  | String      | e.g., "Wendy's", "Parking Lot M".                         |
| `sequence_order` | Integer     | For ordering activities if exact times are fluid.         |
| `metadata`       | JSONB       | Flexible key-value details for activity-specific context. |

### `expenses` (The Ledger)

Tracks the money. Bound by cost. Can optionally link to a specific activity.

| Field Name    | Data Type   | Description                                     |
| :------------ | :---------- | :---------------------------------------------- |
| `id`          | UUID (PK)   | Unique identifier.                              |
| `event_id`    | UUID (FK)   | Parent event (required for total event budget). |
| `activity_id` | UUID (FK)   | Links cost to a specific activity (nullable).   |
| `amount`      | Decimal     | The actual cost (e.g., `45.50`).                |
| `category`    | String/Enum | `food`, `transportation`, `parking`, `tickets`. |
| `description` | String      | e.g., "Gas", "Valet tip", "Round of drinks".    |
| `paid_by`     | UUID        | Tracks which user paid the bill.                |

---

## 2. PostgreSQL / Schema Definition

```sql
-- 1. Create Events Table
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'scheduled',
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    timezone VARCHAR(50) DEFAULT 'UTC',
    is_virtual BOOLEAN DEFAULT false,
    venue_id UUID, -- Assuming a venues table exists
    group_id UUID REFERENCES expense_groups(id) ON DELETE SET NULL,
    is_public BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create Activities Table
CREATE TABLE activities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    location_name VARCHAR(255),
    sequence_order INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create Expenses Table
CREATE TABLE expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,
    amount DECIMAL(10, 2) NOT NULL,
    category VARCHAR(50) NOT NULL,
    description TEXT,
    paid_by UUID, -- Assuming a users table exists
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_events_start_time ON events(start_time);
CREATE INDEX idx_events_group_id ON events(group_id);
CREATE INDEX idx_activities_event_id ON activities(event_id);
CREATE INDEX idx_expenses_event_id ON expenses(event_id);
CREATE INDEX idx_expenses_activity_id ON expenses(activity_id);
```

### Event-to-Group Association Strategy

- `group_id` is intentionally nullable on `events`.
- You can create an event without a group when the final participant list is not verified yet.
- If a qualifying group already exists, you can attach it during event creation.
- You can also attach a group later using the event link-group API (`POST /api/events/:id/link-group`).

### TypeScript 6.0 Interface

#### types/database.ts

```
// types/database.ts

// --- ENUMS & UTILITY TYPES ---

export type EventType = 'concert' | 'formal_dinner' | 'sports' | 'movie' | 'private_party';
export type EventStatus = 'scheduled' | 'ongoing' | 'canceled' | 'completed';
export type ExpenseCategory = 'food' | 'transportation' | 'parking' | 'tickets' | 'misc';

// --- CORE TABLES ---

export interface Event<T = Record<string, unknown>> {
  id: string; // UUID
  title: string;
  description?: string | null;
  type: EventType;
  status: EventStatus;
  start_time: string; // ISO 8601 string from Supabase (TIMESTAMPTZ)
  end_time?: string | null;
  timezone: string;
  is_virtual: boolean;
  venue_id?: string | null; // UUID
  is_public: boolean;
  metadata: T; // Generic type for flexible JSONB payloads
  created_at: string;
}

export interface Activity {
  id: string; // UUID
  event_id: string; // UUID (Foreign Key)
  title: string;
  start_time?: string | null;
  end_time?: string | null;
  location_name?: string | null;
  sequence_order: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Expense {
  id: string; // UUID
  event_id: string; // UUID (Foreign Key)
  activity_id?: string | null; // UUID (Foreign Key)
  amount: number; // Decimal mapped to number in TS
  category: ExpenseCategory;
  description?: string | null;
  paid_by?: string | null; // UUID of the user
  created_at: string;
}

// --- SPECIFIC METADATA EXAMPLES (Optional but recommended) ---

export interface ConcertMetadata {
  headliner: string;
  openers: string[];
  age_restriction?: string;
}

export interface DinnerMetadata {
  dress_code: string;
  caterer?: string;
  plus_ones_allowed: boolean;
}

// Example usage in your frontend code:
// const myConcert: Event<ConcertMetadata> = fetchEventFromSupabase(...)
// console.log(myConcert.metadata.headliner) // Fully typed!

```

### Fetch

Because we set up the Foreign Keys (REFERENCES events(id)) in the SQL schema,
Supabase automatically understands the relationships between these tables.
You don't need to write complex SQL JOIN statements.

You can fetch the main Event, plus all of its associated Activities and
Expenses, in a single network request using Supabase's nested select syntax.

Here is the TypeScript function to drop into your project.

```
// fetchEventDetails.ts
import { supabase } from './supabaseClient'; // Adjust path to your initialized client
import type { Event, Activity, Expense } from './types/database';

// 1. Create a composite type for the joined result
export type EventWithDetails<T = Record<string, unknown>> = Event<T> & {
  activities: Activity[];
  expenses: Expense[];
};

// 2. The Fetch Function
export async function getEventWithDetails(eventId: string): Promise<EventWithDetails | null> {
  const { data, error } = await supabase
    .from('events')
    .select(`
      *,
      activities (*),
      expenses (*)
    `)
    .eq('id', eventId)
    .single(); // Forces it to return an object instead of an array

  if (error) {
    console.error('Error fetching event details:', error.message);
    return null;
  }

  // 3. Supabase returns the data mapped to our exact structure
  return data as EventWithDetails;
}
```

### How the Magic Works:

The secret is inside the .select() string: _, activities(_), expenses(\*).

\*: Grabs all columns from the parent events table.

activities(\*): Looks for any row in the activities table where the event_id matches, grabs all columns, and nests them into an array called activities.

expenses(\*): Does the exact same thing for the expenses table.

Example Usage in Your UI Component
When you call this function, you get a beautifully structured JavaScript
object ready to be mapped over in your frontend:

```
const eventData = await getEventWithDetails('123e4567-e89b-12d3-a456-426614174000');

if (eventData) {
 console.log(`Welcome to: ${eventData.title}`);

 // Easily map through the itinerary
 eventData.activities.forEach(activity => {
   console.log(`- ${activity.title} at ${activity.location_name}`);
 });

 // Calculate total cost on the fly
 const totalCost = eventData.expenses.reduce((sum, exp) => sum + exp.amount, 0);
 console.log(`Total Event Cost: $${totalCost}`);
}
```

Here is the TypeScript function for inserting a new Event along with its
Activities and Expenses.

```
// insertEventData.ts
import { supabase } from './supabaseClient'; // Adjust path
import type { Event, Activity, Expense, EventType, EventStatus } from './types/database';

// 1. Define Omit types for creation (since the DB generates the IDs and created_at)
export type NewEvent = Omit<Event, 'id' | 'created_at'>;
export type NewActivity = Omit<Activity, 'id' | 'event_id' | 'created_at'>;
export type NewExpense = Omit<Expense, 'id' | 'event_id' | 'activity_id' | 'created_at'>;

// 2. The Insert Function
export async function createFullEvent(
 eventData: NewEvent,
 activities: NewActivity[] = [],
 expenses: NewExpense[] = []
): Promise<string | null> {

 // STEP 1: Insert the parent Event
 const { data: newEvent, error: eventError } = await supabase
   .from('events')
   .insert(eventData)
   .select('id') // We only need the new ID back
   .single();

 if (eventError || !newEvent) {
   console.error('Failed to create event:', eventError?.message);
   return null;
 }

 const eventId = newEvent.id;

 // STEP 2: Insert Activities (if any)
 if (activities.length > 0) {
   // Map over the activities to attach the new eventId
   const activitiesWithEventId = activities.map(act => ({
     ...act,
     event_id: eventId
   }));

   const { error: actError } = await supabase
     .from('activities')
     .insert(activitiesWithEventId);

   if (actError) console.error('Error inserting activities:', actError.message);
 }

 // STEP 3: Insert Event-Level Expenses (if any)
 if (expenses.length > 0) {
    // Map over expenses to attach the new eventId
   const expensesWithEventId = expenses.map(exp => ({
     ...exp,
     event_id: eventId
   }));

   const { error: expError } = await supabase
     .from('expenses')
     .insert(expensesWithEventId);

   if (expError) console.error('Error inserting expenses:', expError.message);
 }

 // Return the new Event ID so your frontend can redirect the user to the new event page
 return eventId;
}
```

How to use this in your frontend:
Here is how you would call this function when a user submits your
"Create Event" form. Note how we use the strongly-typed metadata
for a concert!

```
async function handleFormSubmit() {
  const newConcert: NewEvent = {
    title: "Symphony Under the Stars",
    type: "concert",
    status: "scheduled",
    start_time: "2026-07-15T19:00:00Z",
    timezone: "America/Denver",
    is_virtual: false,
    is_public: true,
    metadata: {
      headliner: "Colorado Symphony",
      openers: []
    }
  };

  const initialActivities: NewActivity[] = [
    {
      title: "Gates Open",
      start_time: "2026-07-15T17:30:00Z",
      location_name: "Red Rocks Amphitheatre",
      sequence_order: 1
    }
  ];

  const initialExpenses: NewExpense[] = [
    {
      amount: 150.00,
      category: "tickets",
      description: "2 VIP Tickets"
    }
  ];

  const newEventId = await createFullEvent(newConcert, initialActivities, initialExpenses);

  if (newEventId) {
    console.log("Success! Redirecting to /events/" + newEventId);
  }
}
```

⚠️ A Note on Expense-to-Activity Linking
In this example, the expenses are linked to the overarching Event. If your UI allows a user to link an expense to a specific activity at the exact time of creation, you would need to adjust Step 2. You would need to .select('id') on the activities insert, get those new activity IDs, and attach them to the specific expenses before running Step 3.

When creating relational data in Supabase, the safest and most standard approach is a multi-step insert. You must first create the parent Event so the database can generate its unique id (UUID). Once you have that id, you attach it to the Activities and Expenses and insert them in bulk.

You can add this directly to your documentation.

### How They Work Together

Let's say you are building an itinerary for a live music show. The data relationships would look like this:

- **Event**: Concert at Cervantes'
- **Activity 1**: "Dinner before the show" (Location: Wendy's, Time: 6:00 PM)
- **Expense A**: $25.00 (Category: Food, Linked to Activity 1)
- **Activity 2**: "Drive to Denver & Park" (Time: 7:00 PM)
- **Expense B**: $15.00 (Category: Transportation, Gas)
- **Expense C**: $20.00 (Category: Parking, Valet)
- **Activity 3**: "The Concert" (Time: 8:00 PM)
- **Expense D**: $80.00 (Category: Tickets)
- **Expense E**: $30.00 (Category: Drinks)

By separating them, you can easily query the itinerary chronologically
(ORDER BY start_time) or
calculate the total cost of the night
(SUM(amount) WHERE event_id = ?) without the data clashing.

### Schema at Glance

## TypeScript 6.0 Interface

## Benefits

✅ **Multiple roles** - Person + Worker in one person  
✅ **History tracking** - Email/address changes over time  
✅ **Granular permissions** - RBAC with fine control  
✅ **Scalable** - Easy to add suppliers, contractors  
✅ **Portable** - Same pattern across projects  
✅ **Audit trail** - Who changed what when

##
