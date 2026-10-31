import { Schema, model } from 'mongoose';

/**
 * A kind of event a package can be for ("Wine Tasting", "Wedding Send-off"…), kept as a list in
 * the console so packages tick names from it instead of each typing their own. `key` is the
 * lowercased name and is unique, so "wine tasting" and "Wine Tasting" cannot both exist.
 */
export interface IEventType {
  name: string;
  key: string;
  createdAt: Date;
  updatedAt: Date;
}

const eventTypeSchema = new Schema<IEventType>(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    key: { type: String, required: true, unique: true },
  },
  { timestamps: true },
);

export const EventType = model<IEventType>('EventType', eventTypeSchema);
