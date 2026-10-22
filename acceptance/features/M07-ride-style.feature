@web @plan
Feature: Ride style and bike profile
  As a rider on a specific bike
  I want the plan to respect my bike's range and style
  So that the route is rideable

  Scenario: Bike range shapes the briefing
    Given the rider has chosen a bike profile with a known range
    When the rider plans a route
    Then the briefing reflects that bike's range
    And a route beyond usable range raises a fuel warning

  Scenario: Dirt preference is a mode, not a hint
    Given the rider has planned a route
    When the rider chooses the "Dirt OK" surface preference
    Then the style summary shows "Dirt OK"
    And the plan replans and answers
    And the router is allowed to favor unpaved surfaces
    But sand, private roads and roads without car access never appear

  Scenario: Surface choices stay one tap each
    Given the rider has planned a route
    When the rider switches surface preference between Paved, Mostly paved, Mixed and Dirt OK
    Then each choice is a single tap
    And the style summary always names the current surface
    And the plan replans and answers after every change

  Scenario: Curvy is authored and explained
    Given the rider has chosen the Curvy road character
    When the rider inspects the Frontier routing method
    Then the method explains the authored Curvy choice
    And reading the method does not move the selected route
    When the rider applies the method through its explicit action
    Then the selected route changes

  Scenario: A failed method comparison disables retained comparisons
    Given the rider is inspecting the routing method comparison
    When the routing engine cannot be reached
    Then the comparison says there is no reading for this plan
    And the retained comparisons are disabled instead of showing stale methods

  Scenario: Rider mode follows the bike onto rough tracks
    Given the rider's bike is a dual-sport that allows rough tracks
    When the rider plans with dirt preferred
    Then rough tracks may appear in the plan

  Scenario: Avoiding maintained gravel excludes it from the plan
    Given the rider's bike is set to avoid maintained gravel
    When the rider plans with dirt preferred
    Then maintained gravel is excluded from the plan

  Scenario: ETAs read honest
    Given the rider is comparing route candidates
    Then estimated times are labeled as estimates, never as measurements
    And the method comparison states its model confidence
    And a route no faster than the baseline reads as the same estimated time
