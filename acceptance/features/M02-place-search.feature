@web @plan
Feature: Place search
  As a rider describing a destination
  I want place names to resolve to map points
  So that planning starts from real geography

  Scenario: A typed place name offers matching places
    Given the "Where to, or describe a ride" field is focused
    When the rider types a place name
    Then matching places are offered
    And choosing one places the corresponding map point
