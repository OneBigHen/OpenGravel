@critical @ride @ios @web @device
Feature: Free ride
  As a rider without a plan
  I want to start riding immediately
  So that the app guides me from where I am

  Scenario: Free ride starts from the rider's position
    Given the rider has a GPS fix
    When the rider starts a free ride
    Then navigation begins from the rider's current position
    And ride suggestions are offered

  Scenario: Head home guides back to the saved home
    Given a free ride is in progress
    And the rider has a saved home
    When the rider asks to head home
    Then a guided return to home begins
