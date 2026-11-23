# Liga MX simulator

Compare two Liga MX playoff scenarios without replaying matches that already count.

[Open the public simulator](https://waldoibarra.github.io/liga-mx-demo/) or [run it locally](app/README.md).

The [results workflow](.github/workflows/pages.yml) polls ESPN hourly and publishes valid changes. A failed update leaves the last published snapshot in place. GitHub may delay scheduled runs or disable them after 60 days without repository activity.

The 2026–27 registry covers Apertura 2026 and Clausura 2027. The next supported tournament becomes the default when its predecessor finishes and its full schedule is available. Earlier editions remain selectable. To onboard a new edition, verify the league's rules and roster before adding it to [`app/tournaments.json`](app/tournaments.json). A changed format also needs engine support and regression checks.

The app fixes published final scores and forecasts remaining matches. Early-season projected standings use a draw if the modeled tiebreakers are exhausted. Fair Play and the coefficient table are not simulated. Final published standings take precedence.

## Operations

Run **Update results and publish Pages** from the repository's Actions tab to refresh manually. If validation rejects the feed, inspect the failed run before changing the snapshot. Restore a known-good snapshot and dispatch the workflow again if recovery is necessary.
