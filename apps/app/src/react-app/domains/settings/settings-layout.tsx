import * as React from "react";
import { Info } from "lucide-react";
import { isZenoInterfaceEnabled } from "@/app/lib/zeno-identity";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import "./zeno-settings.css";

export interface LayoutStackProps {
  children: React.ReactNode;
  className?: string;
}

export function LayoutStack({ children, className }: LayoutStackProps) {
  return <div data-settings-stack className={cn("@container/settings flex w-full max-w-3xl flex-col gap-y-6", className)}>{children}</div>;
}

interface LayoutSectionProps {
  id?: string;
  children: React.ReactNode;
}

export function LayoutSection({ children, id }: LayoutSectionProps) {
  return (
    <div id={id} tabIndex={id ? -1 : undefined} data-section className="group/section flex scroll-mt-6 flex-col gap-6">
      {children}
    </div>
  );
}

interface LayoutSectionHeaderProps {
  children: React.ReactNode;
}

export function LayoutSectionHeader({ children }: LayoutSectionHeaderProps) {
  return (
    <div data-settings-section-heading className="flex flex-col gap-1">
      {children}
    </div>
  );
}

interface LayoutSectionTitleProps {
  children: React.ReactNode;
  className?: string;
}

export function LayoutSectionTitle({ children, className }: LayoutSectionTitleProps) {
  return (
    <h3 className={cn("flex items-center gap-2 text-base font-medium text-foreground", className)}>
      {children}
    </h3>
  );
}

interface LayoutSectionDescriptionProps {
  children: React.ReactNode;
  className?: string;
  optional?: boolean;
}

export function LayoutSectionDescription({ children, className, optional }: LayoutSectionDescriptionProps) {
  if (optional && isZenoInterfaceEnabled()) return <SettingsHelp>{children}</SettingsHelp>;
  return (
    <p className={cn("text-sm text-muted-foreground", className)}>
      {children}
    </p>
  );
}

interface LayoutSectionItemProps {
  children: React.ReactNode;
  className?: string;
}

export function LayoutSectionItem({ children, className }: LayoutSectionItemProps) {
  return (
    <div data-settings-item className={cn("flex flex-col gap-3", className)}>
      {children}
    </div>
  );
}

interface LayoutSectionItemHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function LayoutSectionItemHeader({ children, className }: LayoutSectionItemHeaderProps) {
  return (
    <div data-settings-item-heading className={cn("grid auto-rows-min items-start gap-y-1 gap-x-3 has-data-[slot=item-header-actions]:grid-cols-[1fr_auto]", className)}>
      {children}
    </div>
  );
}

interface LayoutSectionItemTitleProps {
  children: React.ReactNode;
  className?: string;
}

export function LayoutSectionItemTitle({ children, className }: LayoutSectionItemTitleProps) {
  return (
    <h4 data-slot="item-title" className={cn("flex items-center gap-2 text-base font-medium text-foreground group-data-section/section:text-sm", className)}>
      {children}
    </h4>
  );
}

interface LayoutSectionItemDescriptionProps {
  children: React.ReactNode;
  className?: string;
  /** Optional guidance can be opened in place; state, consent and risk stay visible. */
  optional?: boolean;
  helpLabel?: string;
}

export function LayoutSectionItemDescription({ children, className, optional, helpLabel }: LayoutSectionItemDescriptionProps) {
  if (optional && isZenoInterfaceEnabled()) {
    return <SettingsHelp label={helpLabel ? `${helpLabel} · ${t("interface.help")}` : undefined}>{children}</SettingsHelp>;
  }
  return (
    <p data-slot="item-description" className={cn("text-sm text-muted-foreground", className)}>
      {children}
    </p>
  );
}

export function SettingsHelp({ children, label = t("interface.help") }: { children: React.ReactNode; label?: string }) {
  return (
    <Popover>
      <PopoverTrigger render={<Button type="button" variant="ghost" size="icon-sm" className="zeno-settings-help text-muted-foreground" aria-label={label}><Info className="size-3.5" /></Button>} />
      <PopoverContent align="start" className="max-w-xs rounded-xl p-3 text-xs leading-relaxed">
        {children}
      </PopoverContent>
    </Popover>
  );
}

interface LayoutSectionItemHeaderActionsProps {
  children: React.ReactNode;
  className?: string;
}

export function LayoutSectionItemHeaderActions({ children, className }: LayoutSectionItemHeaderActionsProps) {
  return (
    <div data-slot="item-header-actions" className={cn("col-start-2 row-span-2 row-start-1 flex flex-wrap items-center gap-2 self-start justify-self-end", className)}>
      {children}
    </div>
  );
}

interface LayoutSectionItemFootnoteProps {
  children: React.ReactNode;
  className?: string;
}

export function LayoutSectionItemFootnote({ children, className }: LayoutSectionItemFootnoteProps) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      {children}
    </p>
  );
}
