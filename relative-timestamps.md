I recommend a progressive transition.
For an active chat room, we want the immediate momentum of relative times for live conversations, but absolute dates are much better for historical context so users don't have to do the mental math on "43 days ago."

A standard, user-friendly threshold breakdown looks like this:

Under 1 hour: "Just now", "5m ago"

1 to 24 hours: "2h ago" (or just the time, like "3:14 PM")

2 to 7 days: "Yesterday" or the day of the week ("Monday")

Over 7 days: Absolute date ("Sep 22" or "09/22/2026")

The Hover Trick (Best of Both Worlds)
Whatever format you decide to display on the screen, embed the exact absolute date and time into the HTML title attribute of the element. If a user ever needs the exact moment a message was sent, they can just hover their mouse over "2h ago" to see the full timestamp in a native browser tooltip.

Implementation Note
Since we are building Chatty using Astro and Alpine.js, handling the relative time calculations client-side with a small Alpine component is highly efficient. It allows a "5m ago" label to dynamically tick up to "6m ago" entirely in the browser, without needing extra HTMX server polling just to update the clocks.