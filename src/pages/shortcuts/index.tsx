import { CursorSelection, ShortcutManager } from "./components";
import { PageLayout } from "@/layouts";

const Shortcuts = () => {
  return (
    <PageLayout
      title="Cursor & Keyboard Shortcuts"
      description="Manage your cursor and keyboard shortcuts"
    >
      <div className="flex flex-col gap-6 pb-8">
        {/* Cursor Selection */}
        <div className="rounded-xl border border-border/60 bg-muted/40 p-5">
          <CursorSelection />
        </div>

        {/* Keyboard Shortcuts */}
        <div className="rounded-xl border border-border/60 bg-muted/40 p-5">
          <ShortcutManager />
        </div>
      </div>
    </PageLayout>
  );
};

export default Shortcuts;
