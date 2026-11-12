import type { ReactNode } from "react";
import { Check, LockKeyhole, Sparkles } from "lucide-react";

export const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
export const date = (ymd: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${ymd}T00:00:00Z`));

// Only destinations with original imagery in the supplied Figma export use a photo.
export function destinationVisual(name: string) {
  return ["Miami", "Nashville", "Asheville"].find((city) =>
    name.toLowerCase().includes(city.toLowerCase()),
  );
}
export function DestinationImage({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) {
  const city = destinationVisual(name);
  return city ? (
    <img
      className={className}
      src={`/images/${city.toLowerCase()}.jpg`}
      alt={`${city} destination`}
    />
  ) : (
    <div
      className={`destination-placeholder ${className}`}
      aria-label="Destination to be decided"
    >
      <Sparkles size={36} />
    </div>
  );
}
export function Avatar({
  name,
  small = false,
}: {
  name: string;
  small?: boolean;
}) {
  const colors = ["#087b72", "#5e79ad", "#b37b64", "#8e76a5", "#779568"];
  const color =
    colors[
      Array.from(name).reduce((sum, c) => sum + c.charCodeAt(0), 0) %
        colors.length
    ];
  return (
    <div
      className={`avatar ${small ? "avatar-sm" : ""}`}
      style={{ background: color }}
      title={name}
    >
      {name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")}
    </div>
  );
}
export function PageTitle({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-title">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <div>
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
    </div>
  );
}
export function PrivacyBanner() {
  return (
    <div className="privacy-banner">
      <LockKeyhole size={21} />
      <div>
        <strong>Your preferences stay private</strong>
        <p>
          Your exact budget and available dates are private. Quorum uses them to
          find a trip that works for the group.
        </p>
      </div>
    </div>
  );
}
export function Progress({ current }: { current: number }) {
  const steps = [
    "Gather preferences",
    "Generate plan",
    "Group approval",
    "Find bookings",
    "Organize trip",
    "Settle expenses",
  ];
  return (
    <div className="progress-card">
      <div className="progress-head">
        <div>
          <span>TRIP PROGRESS</span>
          <strong>
            {
              [
                "Review your private preferences",
                "Generate a plan from group preferences",
                "Your group plan is ready to review",
                "Plan confirmed — review the shared itinerary",
              ][current]
            }
          </strong>
        </div>
        <span>Step {current + 1} of 6</span>
      </div>
      <div className="progress-steps">
        {steps.map((step, i) => (
          <div
            key={step}
            className={`${i < current ? "done" : ""} ${i === current ? "current" : ""}`}
          >
            <div className="step-dot">
              {i < current ? <Check size={14} /> : i + 1}
            </div>
            <span>{step}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
