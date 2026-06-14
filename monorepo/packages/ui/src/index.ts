/**
 * @docmee/ui — Docmee design system (OWNER: Alpha/FE).
 * Tailwind + shadcn-style primitives on the tokens in `styles/globals.css`.
 * apps/web consumes these as source via `transpilePackages`.
 */
export { cn } from "./lib/cn";

export { Button, buttonVariants, type ButtonProps } from "./components/button";
export { Input, type InputProps } from "./components/input";
export { Textarea, type TextareaProps } from "./components/textarea";
export { Label, type LabelProps } from "./components/label";
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./components/card";
export { Badge, badgeVariants, type BadgeProps } from "./components/badge";
export { Spinner, type SpinnerProps } from "./components/spinner";
export { Separator } from "./components/separator";
export { Skeleton } from "./components/skeleton";
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuGroup,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "./components/dropdown-menu";
