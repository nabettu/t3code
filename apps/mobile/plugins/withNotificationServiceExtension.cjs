"use strict";

// Adds the notification service extension that gives watch pushes their per-push button labels.

const fs = require("fs");
const path = require("path");
const { withDangerousMod, withXcodeProject } = require("expo/config-plugins");

const TARGET_NAME = "T3NotificationService";
const FILES = ["NotificationService.swift", "Info.plist"];

function withExtensionFiles(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const source = path.join(cfg.modRequest.projectRoot, "targets", TARGET_NAME);
      const destination = path.join(cfg.modRequest.platformProjectRoot, TARGET_NAME);
      fs.mkdirSync(destination, { recursive: true });
      for (const file of FILES) {
        fs.copyFileSync(path.join(source, file), path.join(destination, file));
      }
      return cfg;
    },
  ]);
}

function withExtensionTarget(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    if (project.pbxTargetByName(TARGET_NAME)) return cfg;

    const appBundleId = cfg.ios?.bundleIdentifier;
    if (!appBundleId) throw new Error(`${TARGET_NAME} needs ios.bundleIdentifier.`);
    const objects = project.hash.project.objects;
    objects.PBXTargetDependency ??= {};
    objects.PBXContainerItemProxy ??= {};

    const group = project.addPbxGroup(FILES, TARGET_NAME, TARGET_NAME);
    const mainGroupId = project.getFirstProject().firstProject.mainGroup;
    project.addToPbxGroup(group.uuid, mainGroupId);

    const target = project.addTarget(
      TARGET_NAME,
      "app_extension",
      TARGET_NAME,
      `${appBundleId}.${TARGET_NAME}`,
    );
    project.addBuildPhase(
      ["NotificationService.swift"],
      "PBXSourcesBuildPhase",
      "Sources",
      target.uuid,
    );
    project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
    project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);

    const appSettings = Object.values(project.pbxXCBuildConfigurationSection()).find(
      (entry) =>
        entry?.buildSettings?.PRODUCT_BUNDLE_IDENTIFIER?.replaceAll('"', "") === appBundleId,
    )?.buildSettings;
    const teamId = cfg.ios?.appleTeamId;
    for (const entry of Object.values(project.pbxXCBuildConfigurationSection())) {
      const settings = entry?.buildSettings;
      if (settings?.PRODUCT_NAME?.replaceAll('"', "") !== TARGET_NAME) continue;
      Object.assign(settings, {
        CODE_SIGN_STYLE: "Automatic",
        CURRENT_PROJECT_VERSION: appSettings?.CURRENT_PROJECT_VERSION ?? 1,
        INFOPLIST_FILE: `${TARGET_NAME}/Info.plist`,
        IPHONEOS_DEPLOYMENT_TARGET: appSettings?.IPHONEOS_DEPLOYMENT_TARGET ?? "16.4",
        MARKETING_VERSION: cfg.version ?? appSettings?.MARKETING_VERSION,
        SWIFT_VERSION: "5.0",
        TARGETED_DEVICE_FAMILY: '"1,2"',
        ...(teamId ? { DEVELOPMENT_TEAM: teamId } : {}),
      });
    }
    if (teamId) project.addTargetAttribute("DevelopmentTeam", teamId, target);
    return cfg;
  });
}

module.exports = function withNotificationServiceExtension(config) {
  return withExtensionTarget(withExtensionFiles(config));
};
