Functions For the administrator:

1. Rename or delete rooms.
2. Block and unblock users.
3. Permanently delete people and their messages.
4. Choose whether to erase entire private conversations or only that person’s messages.
5. Automatically: the app saves conversations, remembers your identity in the browser, tracks unread messages, and reconnects while catching up on missed messages.

The admin controls and private conversations are not implemented yet.
Adding them means:
defining how admins are authorized,
then adding room management,
account blocking/deletion,
and a direct-message model with the two deletion options.

A conservative admin setup would grant access only to explicitly configured account IDs, never based on nickname alone.

We need an "Manage Users Page"
This should have CRUD capability
Admins are created in an admin users 'Manage Users' page
the SQL to do so would be:

```
UPDATE users
SET role = 'admin'
WHERE username = 'target_user';
```

or

```
INSERT INTO human_system_roles (human_id, role_id)
VALUES (
    (SELECT id FROM humans WHERE email = 'target@example.com'),
    (SELECT id FROM system_roles WHERE name = 'admin')
);
```

We can add/have an "user_status" or "user_type" that can be set to 'blocked' or 'set_for_deletion'
'set_for_deletion' has a 30 day times associated with it with some type of notification sent to admin and/or user

We Need a "Manage Rooms Page"
This should have CRUD capability

Rooms can be renamed or deleted
