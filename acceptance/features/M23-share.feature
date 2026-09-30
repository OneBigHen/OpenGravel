@web
Feature: Share a ride
  As a rider who rode something good
  I want to share it
  So that others can ride it too

  Scenario: Shared snapshot respects privacy settings
    Given a ride the rider wants to share
    When the rider shares it
    Then the snapshot trims location precision per the privacy settings
    And the shared ride opens for the recipient
