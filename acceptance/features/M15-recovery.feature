@critical @web @plan
# iOS lane stays "planned": Maestro cannot fail a single request on the
# simulator, and the recovery contract is precisely about one failed attempt
# while the network is otherwise fine. The deterministic assertions live in
# tests/e2e/critical/recovery.spec.ts, which intercepts exactly one attempt.
Feature: Edit failure recovery
  As a rider editing a planned ride when the network drops
  I want the old ride to survive the failed edit
  So that a bad moment never silently eats my plan

  Scenario: A dropped network during an edit keeps the old route and names the failed change
    Given a planned ride
    When an edit fails on the network
    Then the old route stays on the map
    And the failed change is named in understandable words
    And the failure offers retry, edit and discard actions

  Scenario: Retry after the network returns replaces the route and highlights what changed
    Given a failed edit
    When the network returns and the rider retries
    Then the new route replaces the old one
    And the changed span is highlighted against the previous ride

  Scenario: Discard change returns the ride to what it was before the failed edit
    Given a failed edit
    When the rider discards the change
    Then the ride is exactly what it was before the failed edit
    And no failure banner remains
    And no phantom success is recorded
