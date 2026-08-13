import { describe, expect, it } from "vitest";
import source from "./App.vue?raw";
import learningSource from "./components/LearningImitationDialog.vue?raw";
import lazyComponentsSource from "./components/lazyAppComponents.ts?raw";

describe("App lazy feature mounting", () => {
  it("keeps only the default writing surface in the eager component imports", () => {
    expect(source).toContain(
      'from "./components/lazyAppComponents"'
    );
    expect(lazyComponentsSource).toContain("defineAsyncComponent");
    expect(lazyComponentsSource).toContain(
      '() => import("./SettingsPage.vue")'
    );
    expect(lazyComponentsSource).toContain(
      '() => import("./LongWorkspaceEditor.vue")'
    );
    expect(lazyComponentsSource).toContain(
      '() => import("./AgentTeamSettingsPanel.vue")'
    );
    expect(lazyComponentsSource).toContain(
      '() => import("../extras/cloud-backup/CloudBackupPage.vue")'
    );
    expect(lazyComponentsSource).toContain(
      '() => import("./ModelSettingsFeature.vue")'
    );
    expect(lazyComponentsSource).toContain(
      '() => import("./WorkspaceDirectoryFeature.vue")'
    );
    expect(source).not.toContain(
      'import SettingsPage from "./components/SettingsPage.vue"'
    );
    expect(source).not.toContain(
      'import LongWorkspaceEditor from "./components/LongWorkspaceEditor.vue"'
    );
  });

  it("loads model settings and workspace directory as separate features", () => {
    expect(source).toContain('<WorkspaceDirectoryFeature\n');
    expect(source).toContain('<ModelSettingsFeature\n');
    expect(source).not.toContain("<WorkspaceDialog");
    expect(source).not.toContain(
      ':mode="workspaceMainView === \'directory\' ? \'directory\' : \'models\'"'
    );
  });

  it("conditionally mounts mutually exclusive feature pages and heavy dialogs", () => {
    expect(source).toContain('v-if="workspaceMainView === \'marketplace\'"');
    expect(source).toContain('v-if="workspaceMainView === \'cloud-backup\'"');
    expect(source).toContain('v-if="isLongWorkspaceActive"');
    expect(source).toContain('<BookResourceDialog\n      v-if="bookDialogMode"');
    expect(source).toContain('<CreateBookDialog\n      v-if="createBookDialogOpen"');
    expect(source).toContain('<SaveConflictDialog\n      v-if="saveConflict"');
    expect(source).not.toContain('v-show="workspaceMainView');
  });

  it("suspends cached learning-page keyboard work while the page is inactive", () => {
    expect(learningSource).toContain("onActivated(startKeydownListener)");
    expect(learningSource).toContain("onDeactivated(stopKeydownListener)");
    expect(learningSource).toContain("lastCompletedStage.value");
    expect(learningSource).toContain("{ immediate: true }");
  });
});
