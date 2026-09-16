import { ScreenshotConfigs } from "./components";
import { useSettings } from "@/hooks";
import { PageLayout } from "@/layouts";

const Settings = () => {
  const settings = useSettings();
  return (
    <PageLayout
      title="Screenshot"
      description="Manage your screenshot settings"
    >
      {/* Screenshot Configs */}
      <div className="rounded-xl border border-border/60 bg-muted/40 p-5">
        <ScreenshotConfigs {...settings} />
      </div>
    </PageLayout>
  );
};

export default Settings;
