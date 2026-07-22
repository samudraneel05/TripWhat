import mongoose, { Schema, Document } from 'mongoose';

export interface IFlightCache extends Document {
  searchKey: string; // Hash of search parameters
  origin: string;
  destination: string;
  departureDate: string;
  flightData: any;
  createdAt: Date;
  expiresAt: Date;
}

const FlightCacheSchema: Schema = new Schema({
  searchKey: { type: String, required: true, unique: true, index: true },
  origin: { type: String, required: true },
  destination: { type: String, required: true },
  departureDate: { type: String, required: true },
  flightData: { type: Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, index: true },
});

// Auto-delete expired documents
FlightCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IFlightCache>('FlightCache', FlightCacheSchema);
