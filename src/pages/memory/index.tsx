import { PageLayout } from "@/layouts";
import { FilesSettings } from "@/pages/settings/components";

const Files = () => {
  return (
    <PageLayout
      title="Files"
      description="Upload documents or research people and companies for interviews and conversations. Toggle a file on to use it everywhere."
    >
      <FilesSettings />
    </PageLayout>
  );
};

export default Files;
