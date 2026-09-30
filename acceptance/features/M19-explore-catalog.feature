@web @explore
Feature: Explore the ride catalog
  As a rider looking for ideas
  I want to browse shared routes
  So that I can pick one to ride

  Scenario: Route detail leads to the planner
    Given the catalog lists a route with distance and surface summary
    When the rider opens the route detail
    Then the detail shows the route's briefing
    And "Plan this ride" copies it into the planner
