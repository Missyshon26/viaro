import * as React from "react";

interface EmailTemplateProps {
  fullName: string;
  email: string;
  phone: string;
  message: string;
}

export const EmailTemplate: React.FC<Readonly<EmailTemplateProps>> = ({
  fullName,
  email,
  phone,
  message,
}) => (
  <div style={{ fontFamily: "Arial, sans-serif" }}>
    <h2>New Booking Request</h2>
    <p><strong>Name:</strong> {fullName}</p>
    <p><strong>Email:</strong> {email}</p>
    <p><strong>Phone:</strong> {phone}</p>
    <p><strong>Message:</strong></p>
    {/* pre-wrap keeps the line breaks of an itinerary sent from the homepage widget. */}
    <p style={{ whiteSpace: "pre-wrap" }}>{message}</p>
  </div>
);