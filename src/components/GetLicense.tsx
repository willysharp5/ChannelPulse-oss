import type { Dispatch, SetStateAction } from "react";

// The paid purchase/upsell flow has been removed. This component intentionally
// renders nothing so no "Get License / Unlock" buttons appear anywhere. The
// props are kept so existing call sites continue to type-check. A future
// trial/subscription flow can replace this.
export const GetLicense = (_props: {
  setState?: Dispatch<SetStateAction<boolean>>;
  buttonText?: string;
  buttonClassName?: string;
}) => {
  return null;
};
