import {
  ResponseLength,
  LanguageSelector,
  AutoScrollToggle,
} from "./components";
import { PageLayout } from "@/layouts";
import { useApp } from "@/contexts";
import { Lock } from "lucide-react";

const Responses = () => {
  const { hasActiveLicense } = useApp();

  return (
    <PageLayout
      title="Response Settings"
      description="Customize how AI generates and displays responses"
    >
      {!hasActiveLicense && (
        <div className="p-4 bg-primary/10 border border-primary/20 rounded-lg">
          <p className="text-3xs lg:text-sm text-foreground font-medium mb-2 flex items-center gap-1.5">
            <Lock className="size-3.5 shrink-0" />
            Premium Features
          </p>
          <p className="text-3xs lg:text-sm text-muted-foreground">
            Response customization features (Response Length, Language
            Selection, and Auto-Scroll Control) require an active license to
            use.
          </p>
        </div>
      )}

      {/* Response Length */}
      <div className="rounded-xl border border-border/60 bg-muted/40 p-5">
        <ResponseLength />
      </div>

      {/* Language Selector */}
      <div className="rounded-xl border border-border/60 bg-muted/40 p-5">
        <LanguageSelector />
      </div>

      {/* Auto-Scroll Toggle */}
      <div className="rounded-xl border border-border/60 bg-muted/40 p-5">
        <AutoScrollToggle />
      </div>
    </PageLayout>
  );
};

export default Responses;
