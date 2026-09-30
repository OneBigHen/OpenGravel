@web @network @device
Feature: Offline basemap
  As a rider heading somewhere with no signal
  I want the map cached ahead of time
  So that I still see the map offline

  Scenario: Cached region renders offline
    Given a basemap region has been downloaded
    When the network is unavailable
    Then the map renders from the cached region
    And the offline readiness indicator says offline ready
