@web @device
Feature: Settings
  As a rider personalizing the app
  I want home, bike and app settings to persist
  So that they survive reloads

  Scenario: Home and bike persist on this device
    Given the rider saves a home location and a bike profile
    When the rider reloads the app
    Then the home location is still set
    And the bike profile is still selected
