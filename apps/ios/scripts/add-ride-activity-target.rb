#!/usr/bin/env ruby
# Adds the RideActivityWidget (Live Activity) extension to App.xcodeproj and the
# app's own Swift files to the App target. Idempotent: safe to run again.
#   gem install --user-install xcodeproj && ruby scripts/add-ride-activity-target.rb
require "xcodeproj"

root = File.expand_path("../ios/App", __dir__)
project = Xcodeproj::Project.open(File.join(root, "App.xcodeproj"))
app = project.targets.find { |t| t.name == "App" } or abort "no App target"
app_group = project.main_group.find_subpath("App", false) or abort "no App group"

def add_source(group, target, path)
  ref = group.files.find { |f| f.path == path } || group.new_reference(path)
  target.add_file_references([ref]) unless target.source_build_phase.files_references.include?(ref)
  ref
end

%w[RideActivityAttributes.swift RideActivityPlugin.swift MainViewController.swift].each do |file|
  add_source(app_group, app, file)
end

ext = project.targets.find { |t| t.name == "RideActivityWidget" }
unless ext
  ext = project.new_target(:app_extension, "RideActivityWidget", :ios, "16.2")
  ext.build_configurations.each do |config|
    s = config.build_settings
    s["PRODUCT_BUNDLE_IDENTIFIER"] = "org.onebighen.opengravel.RideActivityWidget"
    s["PRODUCT_NAME"] = "$(TARGET_NAME)"
    s["INFOPLIST_FILE"] = "RideActivityWidget/Info.plist"
    s["SWIFT_VERSION"] = "5.0"
    s["TARGETED_DEVICE_FAMILY"] = "1,2"
    s["IPHONEOS_DEPLOYMENT_TARGET"] = "16.2"
    s["SKIP_INSTALL"] = "YES"
    s["CODE_SIGN_STYLE"] = "Automatic"
    s["DEVELOPMENT_TEAM"] = "PKTSAV4JSX"
    s["MARKETING_VERSION"] = "1.0"
    s["CURRENT_PROJECT_VERSION"] = "1"
    s["LD_RUNPATH_SEARCH_PATHS"] = ["$(inherited)", "@executable_path/Frameworks", "@executable_path/../../Frameworks"]
    s["APPLICATION_EXTENSION_API_ONLY"] = "YES"
  end
  %w[WidgetKit SwiftUI].each do |framework|
    ref = project.frameworks_group.new_file("System/Library/Frameworks/#{framework}.framework", :sdk_root)
    ext.frameworks_build_phase.add_file_reference(ref)
  end
  app.add_dependency(ext)
  embed = app.new_copy_files_build_phase("Embed Foundation Extensions")
  embed.symbol_dst_subfolder_spec = :plug_ins
  build_file = embed.add_file_reference(ext.product_reference)
  build_file.settings = { "ATTRIBUTES" => ["RemoveHeadersOnCopy"] }
end

ext_group = project.main_group.find_subpath("RideActivityWidget", true)
ext_group.set_source_tree("<group>")
ext_group.set_path("RideActivityWidget")
%w[RideActivityWidgetBundle.swift RideActivityLiveActivity.swift].each { |file| add_source(ext_group, ext, file) }
ext_group.files.find { |f| f.path == "Info.plist" } || ext_group.new_reference("Info.plist")
# The attributes type is shared: the widget draws what the app starts.
shared = app_group.files.find { |f| f.path == "RideActivityAttributes.swift" }
ext.add_file_references([shared]) unless ext.source_build_phase.files_references.include?(shared)

project.save
puts "ok: #{project.targets.map(&:name).join(', ')}"
