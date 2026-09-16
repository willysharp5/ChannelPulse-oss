import {
  Button,
  Badge,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui";
import { useAuth } from "@/contexts";
import { isSubscriptionActive } from "@/lib/auth";
import { UserIcon, LogOutIcon } from "lucide-react";

const initials = (email: string) => email.slice(0, 2).toUpperCase();

export const AccountButton = () => {
  const { configured, isSignedIn, user, subscription, trialDaysLeft, signOut } =
    useAuth();

  if (!configured || !isSignedIn || !user) return null;

  const email = user.email ?? "Account";
  const plan = subscription?.plan ?? "free";
  const active = isSubscriptionActive(subscription);
  const statusLabel =
    subscription?.status === "trialing" && trialDaysLeft != null
      ? `trial · ${trialDaysLeft}d left`
      : subscription?.status ?? "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <span className="flex size-5 items-center justify-center rounded-full bg-primary/15 text-3xs font-semibold text-primary">
            {initials(email)}
          </span>
          <Badge
            variant={active ? "default" : "outline"}
            className="text-3xs capitalize"
          >
            {active ? plan : "no plan"}
          </Badge>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex items-center gap-2">
          <UserIcon className="size-3.5" />
          <span className="truncate text-xs font-normal">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          Plan: <span className="capitalize text-foreground">{plan}</span>
          {statusLabel ? ` · ${statusLabel}` : ""}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut()} className="gap-2">
          <LogOutIcon className="size-3.5" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
