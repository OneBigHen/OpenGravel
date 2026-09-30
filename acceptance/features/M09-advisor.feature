@web @plan
Feature: Ride advisor proposals
  As a rider open to suggestions
  I want the advisor's proposals on my route
  So that I can consider alternatives

  Scenario: Advisor proposes alternatives
    Given a planned route
    When the rider asks the advisor
    Then at least one alternative proposal is presented
    And each proposal explains why it was suggested
