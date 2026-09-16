import { Button, Card, DragButton } from "@/components";
import { RefreshCcwIcon } from "lucide-react";

export const ErrorLayout = ({
  isCompact,
  message,
}: {
  isCompact?: boolean;
  message?: string;
}) => {
  return isCompact ? (
    <Card className="flex flex-row w-screen h-screen items-center justify-between p-4">
      <img
        src="/app-icon.png"
        alt="ChannelPulse"
        className="size-8 rounded-xl"
      />
      <div className="min-w-0">
        <p className="text-sm md:text-xl">
          Oops! Something went wrong. Click reload to restart the app.
        </p>
        {message ? (
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {message}
          </p>
        ) : null}
      </div>

      <div className="flex flex-row items-center gap-2">
        <Button size="icon" onClick={() => window.location.reload()}>
          <RefreshCcwIcon className="size-4" />
        </Button>
        <DragButton />
      </div>
    </Card>
  ) : (
    <div className="relative flex flex-col h-screen w-screen justify-center items-center overflow-hidden bg-background">
      <div className="flex flex-col justify-center items-center gap-8 max-w-[37.5rem] px-4 animate-fadeIn">
        <div className="absolute top-1/4 left-0 right-0 flex justify-center items-center transform hover:scale-105 transition-transform duration-200">
          <div className="flex h-16 items-center px-4 pt-10 gap-2">
            <img
              src="/app-icon.png"
              alt="ChannelPulse"
              className="size-6 rounded-lg"
            />
            <h1 className="text-md font-semibold text-foreground">ChannelPulse</h1>
          </div>
        </div>

        <div className="flex flex-col gap-4 items-center text-center select-none mt-8">
          <h1 className="text-6xl md:text-6xl font-bold hover:scale-105 transition-transform duration-200">
            Oops!
          </h1>
          <div className="space-y-2">
            <p className="text-xl md:text-2xl font-medium text-foreground">
              Something unexpected happened
            </p>
            <p className="text-sm md:text-base text-muted-foreground">
              Don't worry! Just click the reload button below to restart the
              app.
            </p>
            {message ? (
              <p className="mt-2 max-w-[32.5rem] break-words rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
                {message}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 w-[12.5rem]">
          <Button
            variant="default"
            onClick={() => window.location.reload()}
            className="w-full shadow-sm hover:shadow-md transition-shadow duration-200"
          >
            <RefreshCcwIcon className="size-4" /> Reload
          </Button>
        </div>
      </div>
    </div>
  );
};
