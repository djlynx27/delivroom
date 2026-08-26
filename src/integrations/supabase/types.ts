export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.4';
  };
  public: {
    Tables: {
      cities: {
        Row: {
          created_at: string;
          id: string;
          name: string;
        };
        Insert: {
          created_at?: string;
          id: string;
          name: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      daily_reports: {
        Row: {
          ai_recommendation: string | null;
          best_time_slot: string | null;
          best_zone_name: string | null;
          created_at: string;
          dead_time_pct: number | null;
          hours_worked: number | null;
          id: string;
          report_date: string;
          total_distance_km: number | null;
          total_earnings: number | null;
          total_trips: number | null;
          worst_zone_name: string | null;
        };
        Insert: {
          ai_recommendation?: string | null;
          best_time_slot?: string | null;
          best_zone_name?: string | null;
          created_at?: string;
          dead_time_pct?: number | null;
          hours_worked?: number | null;
          id?: string;
          report_date: string;
          total_distance_km?: number | null;
          total_earnings?: number | null;
          total_trips?: number | null;
          worst_zone_name?: string | null;
        };
        Update: {
          ai_recommendation?: string | null;
          best_time_slot?: string | null;
          best_zone_name?: string | null;
          created_at?: string;
          dead_time_pct?: number | null;
          hours_worked?: number | null;
          id?: string;
          report_date?: string;
          total_distance_km?: number | null;
          total_earnings?: number | null;
          total_trips?: number | null;
          worst_zone_name?: string | null;
        };
        Relationships: [];
      };
      driver_notes: {
        Row: {
          created_at: string;
          id: string;
          note: string;
          trip_date: string | null;
          zone_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          note: string;
          trip_date?: string | null;
          zone_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          note?: string;
          trip_date?: string | null;
          zone_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'driver_notes_zone_id_fkey';
            columns: ['zone_id'];
            isOneToOne: false;
            referencedRelation: 'zones';
            referencedColumns: ['id'];
          },
        ];
      };
      earnings: {
        Row: {
          amount: number;
          created_at: string;
          date: string;
          duration_min: number | null;
          id: string;
          km: number;
          note: string | null;
        };
        Insert: {
          amount?: number;
          created_at?: string;
          date?: string;
          duration_min?: number | null;
          id?: string;
          km?: number;
          note?: string | null;
        };
        Update: {
          amount?: number;
          created_at?: string;
          date?: string;
          duration_min?: number | null;
          id?: string;
          km?: number;
          note?: string | null;
        };
        Relationships: [];
      };
      events: {
        Row: {
          boost_multiplier: number;
          boost_radius_km: number;
          boost_zone_types: string[] | null;
          capacity: number | null;
          category: string;
          city_id: string;
          created_at: string;
          demand_impact: number;
          end_at: string;
          expected_attendance: number | null;
          id: string;
          is_holiday: boolean;
          latitude: number;
          longitude: number;
          name: string;
          source: string | null;
          start_at: string;
          venue: string;
          zone_id: string | null;
        };
        Insert: {
          boost_multiplier?: number;
          boost_radius_km?: number;
          boost_zone_types?: string[] | null;
          capacity?: number | null;
          category?: string;
          city_id?: string;
          created_at?: string;
          demand_impact?: number;
          end_at: string;
          expected_attendance?: number | null;
          id?: string;
          is_holiday?: boolean;
          latitude: number;
          longitude: number;
          name: string;
          source?: string | null;
          start_at: string;
          venue: string;
          zone_id?: string | null;
        };
        Update: {
          boost_multiplier?: number;
          boost_radius_km?: number;
          boost_zone_types?: string[] | null;
          capacity?: number | null;
          category?: string;
          city_id?: string;
          created_at?: string;
          demand_impact?: number;
          end_at?: string;
          expected_attendance?: number | null;
          id?: string;
          is_holiday?: boolean;
          latitude?: number;
          longitude?: number;
          name?: string;
          source?: string | null;
          start_at?: string;
          venue?: string;
          zone_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'events_zone_id_fkey';
            columns: ['zone_id'];
            isOneToOne: false;
            referencedRelation: 'zones';
            referencedColumns: ['id'];
          },
        ];
      };
      demand_patterns: {
        Row: {
          actual_earnings_per_hour: number | null;
          context_vector: string;
          created_at: string;
          id: number;
          zone_id: string;
        };
        Insert: {
          actual_earnings_per_hour?: number | null;
          context_vector: string;
          created_at?: string;
          id?: number;
          zone_id: string;
        };
        Update: {
          actual_earnings_per_hour?: number | null;
          context_vector?: string;
          created_at?: string;
          id?: number;
          zone_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'demand_patterns_zone_id_fkey';
            columns: ['zone_id'];
            isOneToOne: false;
            referencedRelation: 'zones';
            referencedColumns: ['id'];
          },
        ];
      };
      ema_patterns: {
        Row: {
          day_of_week: number;
          ema_earnings_per_hour: number;
          ema_ride_count: number;
          hour_block: number;
          last_updated: string;
          observation_count: number;
          zone_id: string;
        };
        Insert: {
          day_of_week: number;
          ema_earnings_per_hour?: number;
          ema_ride_count?: number;
          hour_block: number;
          last_updated?: string;
          observation_count?: number;
          zone_id: string;
        };
        Update: {
          day_of_week?: number;
          ema_earnings_per_hour?: number;
          ema_ride_count?: number;
          hour_block?: number;
          last_updated?: string;
          observation_count?: number;
          zone_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ema_patterns_zone_id_fkey';
            columns: ['zone_id'];
            isOneToOne: false;
            referencedRelation: 'zones';
            referencedColumns: ['id'];
          },
        ];
      };
      platform_signals: {
        Row: {
          captured_at: string;
          created_at: string;
          demand_level: number;
          estimated_wait_min: number | null;
          id: string;
          platform: string;
          source: string;
          surge_active: boolean;
          surge_multiplier: number | null;
          zone_id: string;
        };
        Insert: {
          captured_at?: string;
          created_at?: string;
          demand_level?: number;
          estimated_wait_min?: number | null;
          id?: string;
          platform: string;
          source?: string;
          surge_active?: boolean;
          surge_multiplier?: number | null;
          zone_id: string;
        };
        Update: {
          captured_at?: string;
          created_at?: string;
          demand_level?: number;
          estimated_wait_min?: number | null;
          id?: string;
          platform?: string;
          source?: string;
          surge_active?: boolean;
          surge_multiplier?: number | null;
          zone_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'platform_signals_zone_id_fkey';
            columns: ['zone_id'];
            isOneToOne: false;
            referencedRelation: 'zones';
            referencedColumns: ['id'];
          },
        ];
      };
      predictions: {
        Row: {
          actual_earnings_per_hour: number | null;
          created_at: string;
          factors_snapshot: Json | null;
          id: number;
          predicted_at: string;
          predicted_score: number;
          prediction_error: number | null;
          zone_id: string;
        };
        Insert: {
          actual_earnings_per_hour?: number | null;
          created_at?: string;
          factors_snapshot?: Json | null;
          id?: number;
          predicted_at: string;
          predicted_score: number;
          prediction_error?: number | null;
          zone_id: string;
        };
        Update: {
          actual_earnings_per_hour?: number | null;
          created_at?: string;
          factors_snapshot?: Json | null;
          id?: number;
          predicted_at?: string;
          predicted_score?: number;
          prediction_error?: number | null;
          zone_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'predictions_zone_id_fkey';
            columns: ['zone_id'];
            isOneToOne: false;
            referencedRelation: 'zones';
            referencedColumns: ['id'];
          },
        ];
      };
      score_history: {
        Row: {
          created_at: string;
          id: string;
          reason: string | null;
          score: number | null;
          zone_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          reason?: string | null;
          score?: number | null;
          zone_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          reason?: string | null;
          score?: number | null;
          zone_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'score_history_zone_id_fkey';
            columns: ['zone_id'];
            isOneToOne: false;
            referencedRelation: 'zones';
            referencedColumns: ['id'];
          },
        ];
      };
      scores: {
        Row: {
          calculated_at: string;
          event_boost: number | null;
          final_score: number | null;
          id: string;
          score: number | null;
          weather_boost: number | null;
          zone_id: string;
        };
        Insert: {
          calculated_at?: string;
          event_boost?: number | null;
          final_score?: number | null;
          id?: string;
          score?: number | null;
          weather_boost?: number | null;
          zone_id: string;
        };
        Update: {
          calculated_at?: string;
          event_boost?: number | null;
          final_score?: number | null;
          id?: string;
          score?: number | null;
          weather_boost?: number | null;
          zone_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'scores_zone_id_fkey';
            columns: ['zone_id'];
            isOneToOne: false;
            referencedRelation: 'zones';
            referencedColumns: ['id'];
          },
        ];
      };
      session_zones: {
        Row: {
          created_at: string;
          earnings: number;
          entered_at: string;
          exited_at: string | null;
          factors_snapshot: Json | null;
          id: number;
          predicted_score: number | null;
          rides_count: number;
          session_id: number;
          zone_id: string;
        };
        Insert: {
          created_at?: string;
          earnings?: number;
          entered_at: string;
          exited_at?: string | null;
          factors_snapshot?: Json | null;
          id?: number;
          predicted_score?: number | null;
          rides_count?: number;
          session_id: number;
          zone_id: string;
        };
        Update: {
          created_at?: string;
          earnings?: number;
          entered_at?: string;
          exited_at?: string | null;
          factors_snapshot?: Json | null;
          id?: number;
          predicted_score?: number | null;
          rides_count?: number;
          session_id?: number;
          zone_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'session_zones_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'sessions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'session_zones_zone_id_fkey';
            columns: ['zone_id'];
            isOneToOne: false;
            referencedRelation: 'zones';
            referencedColumns: ['id'];
          },
        ];
      };
      sessions: {
        Row: {
          created_at: string;
          ended_at: string | null;
          id: number;
          notes: string | null;
          started_at: string;
          total_earnings: number | null;
          total_hours: number | null;
          total_rides: number | null;
          weather_snapshot: Json | null;
        };
        Insert: {
          created_at?: string;
          ended_at?: string | null;
          id?: number;
          notes?: string | null;
          started_at: string;
          total_earnings?: number | null;
          total_hours?: number | null;
          total_rides?: number | null;
          weather_snapshot?: Json | null;
        };
        Update: {
          created_at?: string;
          ended_at?: string | null;
          id?: number;
          notes?: string | null;
          started_at?: string;
          total_earnings?: number | null;
          total_hours?: number | null;
          total_rides?: number | null;
          weather_snapshot?: Json | null;
        };
        Relationships: [];
      };
      time_slots: {
        Row: {
          city_id: string;
          comment: string | null;
          created_at: string;
          date: string;
          demand_score: number;
          end_time: string;
          id: string;
          start_time: string;
          zone_id: string;
        };
        Insert: {
          city_id: string;
          comment?: string | null;
          created_at?: string;
          date: string;
          demand_score?: number;
          end_time: string;
          id?: string;
          start_time: string;
          zone_id: string;
        };
        Update: {
          city_id?: string;
          comment?: string | null;
          created_at?: string;
          date?: string;
          demand_score?: number;
          end_time?: string;
          id?: string;
          start_time?: string;
          zone_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'time_slots_city_id_fkey';
            columns: ['city_id'];
            isOneToOne: false;
            referencedRelation: 'cities';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'time_slots_zone_id_fkey';
            columns: ['zone_id'];
            isOneToOne: false;
            referencedRelation: 'zones';
            referencedColumns: ['id'];
          },
        ];
      };
      trips: {
        Row: {
          created_at: string;
          distance_km: number | null;
          earnings: number | null;
          ended_at: string | null;
          experiment: boolean;
          id: string;
          notes: string | null;
          platform: string | null;
          started_at: string;
          tips: number | null;
          zone_id: string | null;
          zone_score: number | null;
        };
        Insert: {
          created_at?: string;
          distance_km?: number | null;
          earnings?: number | null;
          ended_at?: string | null;
          experiment?: boolean;
          id?: string;
          notes?: string | null;
          platform?: string | null;
          started_at?: string;
          tips?: number | null;
          zone_id?: string | null;
          zone_score?: number | null;
        };
        Update: {
          created_at?: string;
          distance_km?: number | null;
          earnings?: number | null;
          ended_at?: string | null;
          experiment?: boolean;
          id?: string;
          notes?: string | null;
          platform?: string | null;
          started_at?: string;
          tips?: number | null;
          zone_id?: string | null;
          zone_score?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'trips_zone_id_fkey';
            columns: ['zone_id'];
            isOneToOne: false;
            referencedRelation: 'zones';
            referencedColumns: ['id'];
          },
        ];
      };
      user_pings: {
        Row: {
          captured_at: string;
          context_vector: string;
          created_at: string;
          driver_fingerprint: string;
          id: string;
          metadata: Json | null;
          platform: string;
          success_score: number;
          zone_id: string;
        };
        Insert: {
          captured_at?: string;
          context_vector: string;
          created_at?: string;
          driver_fingerprint: string;
          id?: string;
          metadata?: Json | null;
          platform?: string;
          success_score?: number;
          zone_id: string;
        };
        Update: {
          captured_at?: string;
          context_vector?: string;
          created_at?: string;
          driver_fingerprint?: string;
          id?: string;
          metadata?: Json | null;
          platform?: string;
          success_score?: number;
          zone_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_pings_zone_id_fkey';
            columns: ['zone_id'];
            isOneToOne: false;
            referencedRelation: 'zones';
            referencedColumns: ['id'];
          },
        ];
      };
      weight_history: {
        Row: {
          created_at: string;
          id: number;
          prediction_mae: number | null;
          triggered_by: string;
          weights: Json;
        };
        Insert: {
          created_at?: string;
          id?: number;
          prediction_mae?: number | null;
          triggered_by?: string;
          weights: Json;
        };
        Update: {
          created_at?: string;
          id?: number;
          prediction_mae?: number | null;
          triggered_by?: string;
          weights?: Json;
        };
        Relationships: [];
      };
      zone_beliefs: {
        Row: {
          day_of_week: number;
          hour_block: number;
          last_updated: string;
          observation_count: number;
          prior_mean: number;
          prior_variance: number;
          zone_id: string;
        };
        Insert: {
          day_of_week: number;
          hour_block: number;
          last_updated?: string;
          observation_count?: number;
          prior_mean?: number;
          prior_variance?: number;
          zone_id: string;
        };
        Update: {
          day_of_week?: number;
          hour_block?: number;
          last_updated?: string;
          observation_count?: number;
          prior_mean?: number;
          prior_variance?: number;
          zone_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'zone_beliefs_zone_id_fkey';
            columns: ['zone_id'];
            isOneToOne: false;
            referencedRelation: 'zones';
            referencedColumns: ['id'];
          },
        ];
      };
      zones: {
        Row: {
          address: string | null;
          base_score: number | null;
          category: string | null;
          city_id: string;
          created_at: string;
          current_score: number | null;
          id: string;
          latitude: number;
          longitude: number;
          name: string;
          territory: string | null;
          type: Database['public']['Enums']['zone_type'];
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          base_score?: number | null;
          category?: string | null;
          city_id: string;
          created_at?: string;
          current_score?: number | null;
          id?: string;
          latitude: number;
          longitude: number;
          name: string;
          territory?: string | null;
          type?: Database['public']['Enums']['zone_type'];
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          base_score?: number | null;
          category?: string | null;
          city_id?: string;
          created_at?: string;
          current_score?: number | null;
          id?: string;
          latitude?: number;
          longitude?: number;
          name?: string;
          territory?: string | null;
          type?: Database['public']['Enums']['zone_type'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'zones_city_id_fkey';
            columns: ['city_id'];
            isOneToOne: false;
            referencedRelation: 'cities';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      get_latest_scores: {
        Args: {
          p_city_id: string;
        };
        Returns: {
          id: string;
          zone_id: string;
          score: number | null;
          weather_boost: number | null;
          event_boost: number | null;
          final_score: number | null;
          calculated_at: string;
        }[];
      };
      match_user_pings: {
        Args: {
          match_count?: number;
          query_driver_fingerprint: string;
          query_platform?: string;
          query_vector: string;
          query_zone_id?: string | null;
        };
        Returns: {
          created_at: string;
          id: string;
          similarity: number;
          success_score: number;
          zone_id: string;
        }[];
      };
      match_similar_contexts: {
        Args: {
          match_count?: number;
          query_vector: string;
          query_zone_id: string;
        };
        Returns: {
          actual_earnings_per_hour: number;
          created_at: string;
          id: number;
          similarity: number;
          zone_id: string;
        }[];
      };
    };
    Enums: {
      zone_type:
        | 'métro'
        | 'commercial'
        | 'résidentiel'
        | 'nightlife'
        | 'aéroport'
        | 'transport'
        | 'médical'
        | 'université'
        | 'événements'
        | 'tourisme';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  'public'
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      zone_type: [
        'métro',
        'commercial',
        'résidentiel',
        'nightlife',
        'aéroport',
        'transport',
        'médical',
        'université',
        'événements',
        'tourisme',
      ],
    },
  },
} as const;
