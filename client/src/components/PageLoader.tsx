import { Spinner } from "./ui";

export function PageLoader() {
  return (
    <div className="p-6 flex justify-center">
      <Spinner></Spinner>
    </div>
  );
}
