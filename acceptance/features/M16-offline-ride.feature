@critical @ride @ios @web @network
Feature: Ride while offline
  As a rider in a dead zone
  I want navigation to keep working without a network
  So that the ride is not interrupted

  Scenario: Offline ride continues on device
    Given the rider has cached the route corridor for offline use
    And the network is unavailable
    When the rider starts the ride
    Then navigation proceeds from on-device data
    And the app states its offline limits honestly
