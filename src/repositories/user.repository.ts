import { MongoServerError, ObjectId, type Collection, type Db } from 'mongodb';
import { COLLECTIONS } from '../db/collections.js';

export interface UserDocument {
  _id: ObjectId;
  /** Lowercased, so "Ana@x.com" and "ana@x.com" are the same account. */
  email: string;
  passwordHash: string;
  createdAt: Date;
}

const DUPLICATE_KEY = 11000;

export class UserRepository {
  private readonly collection: Collection<UserDocument>;

  constructor(db: Db) {
    this.collection = db.collection<UserDocument>(COLLECTIONS.users);
  }

  /** Returns the new user, or null if the email is already registered. */
  async insert(email: string, passwordHash: string): Promise<UserDocument | null> {
    const user: UserDocument = { _id: new ObjectId(), email, passwordHash, createdAt: new Date() };
    try {
      await this.collection.insertOne(user);
      return user;
    } catch (error) {
      // The unique index on email decides; checking first and then inserting
      // would let two simultaneous sign-ups with the same email both pass.
      if (error instanceof MongoServerError && error.code === DUPLICATE_KEY) {
        return null;
      }
      throw error;
    }
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.collection.findOne({ email });
  }
}
