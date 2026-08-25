/**
 * Ribbon function file.
 *
 * The ribbon button opens the task pane directly, so nothing here runs during
 * a normal send. Word still requires a registered function file for the
 * desktop form factor, and `openMailPane` gives us a hook for a future
 * one-click "send with last settings" command.
 */

Office.onReady(() => {
  if (Office.actions?.associate) {
    Office.actions.associate('openMailPane', openMailPane);
  }
});

function openMailPane(event) {
  // Word opens the task pane from the manifest action; this only signals
  // completion so the ribbon stops showing a busy state.
  event.completed();
}
