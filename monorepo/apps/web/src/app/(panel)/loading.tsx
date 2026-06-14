import { Spinner } from "@docmee/ui";

export default function PanelLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner className="h-6 w-6" />
    </div>
  );
}
