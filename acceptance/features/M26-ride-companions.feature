@critical @ride @ios @web
Feature: Ride companions (Spotify)
  As a rider who listens to music while riding
  I want optional Spotify controls during the ride
  So that I can control playback without leaving the ride screen

  Scenario: Spotify controls do not disturb the ride
    Given the rider has started a ride
    When the rider connects Spotify
    Then playback controls appear on the ride screen
    And the ride recording continues undisturbed
    When the rider cancels Spotify authorization
    Then the ride keeps going and no error is shown

  Scenario: Spotify setup explains itself
    Given the rider opens Spotify setup
    Then setup accepts only a public client ID
    And setup explains the exact browser callback to configure
