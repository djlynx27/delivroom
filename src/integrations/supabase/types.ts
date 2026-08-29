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
    PostgrestVersion: "14.5";
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
      content_pipeline: {
        Row: {
          audio_url: string | null;
          created_at: string;
          cta_text: string | null;
          hook_text: string | null;
          id: string;
          niche: string | null;
          scheduled_at: string | null;
          script_body: string;
          status: string | null;
          title: string;
          topic_source_url: string | null;
          user_id: string;
          video_url: string | null;
        };
        Insert: {
          audio_url?: string | null;
          created_at?: string;
          cta_text?: string | null;
          hook_text?: string | null;
          id?: string;
          niche?: string | null;
          scheduled_at?: string | null;
          script_body: string;
          status?: string | null;
          title: string;
          topic_source_url?: string | null;
          user_id?: string;
          video_url?: string | null;
        };
        Update: {
          audio_url?: string | null;
          created_at?: string;
          cta_text?: string | null;
          hook_text?: string | null;
          id?: string;
          niche?: string | null;
          scheduled_at?: string | null;
          script_body?: string;
          status?: string | null;
          title?: string;
          topic_source_url?: string | null;
          user_id?: string;
          video_url?: string | null;
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
          id?: never;
          zone_id: string;
        };
        Update: {
          actual_earnings_per_hour?: number | null;
          context_vector?: string;
          created_at?: string;
          id?: never;
          zone_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "demand_patterns_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
          },
        ];
      };
      driver_metrics: {
        Row: {
          acceptance_rate: number | null;
          cancellation_rate: number | null;
          id: string;
          measured_at: string;
          notes: string | null;
          platform: string;
          rating: number | null;
          source: string;
          trips_completed: number | null;
          user_id: string;
        };
        Insert: {
          acceptance_rate?: number | null;
          cancellation_rate?: number | null;
          id?: string;
          measured_at?: string;
          notes?: string | null;
          platform: string;
          rating?: number | null;
          source?: string;
          trips_completed?: number | null;
          user_id: string;
        };
        Update: {
          acceptance_rate?: number | null;
          cancellation_rate?: number | null;
          id?: string;
          measured_at?: string;
          notes?: string | null;
          platform?: string;
          rating?: number | null;
          source?: string;
          trips_completed?: number | null;
          user_id?: string;
        };
        Relationships: [];
      };
      driver_quests: {
        Row: {
          bonus_amount: number;
          created_at: string;
          current_count: number;
          deadline: string;
          id: string;
          name: string;
          platform: string;
          status: string;
          target_count: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          bonus_amount?: number;
          created_at?: string;
          current_count?: number;
          deadline: string;
          id?: string;
          name: string;
          platform: string;
          status?: string;
          target_count: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          bonus_amount?: number;
          created_at?: string;
          current_count?: number;
          deadline?: string;
          id?: string;
          name?: string;
          platform?: string;
          status?: string;
          target_count?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      edge_rate_limits: {
        Row: {
          count: number;
          fn: string;
          window_start: string;
        };
        Insert: {
          count?: number;
          fn: string;
          window_start: string;
        };
        Update: {
          count?: number;
          fn?: string;
          window_start?: string;
        };
        Relationships: [];
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
            foreignKeyName: "ema_patterns_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
          },
        ];
      };
      events: {
        Row: {
          boost_multiplier: number;
          boost_radius_km: number;
          boost_zone_types: string[];
          capacity: number;
          category: string;
          city_id: string;
          created_at: string;
          demand_impact: number;
          end_at: string;
          id: string;
          is_holiday: boolean;
          latitude: number;
          longitude: number;
          name: string;
          start_at: string;
          venue: string;
        };
        Insert: {
          boost_multiplier?: number;
          boost_radius_km?: number;
          boost_zone_types?: string[];
          capacity?: number;
          category?: string;
          city_id: string;
          created_at?: string;
          demand_impact?: number;
          end_at: string;
          id?: string;
          is_holiday?: boolean;
          latitude: number;
          longitude: number;
          name: string;
          start_at: string;
          venue: string;
        };
        Update: {
          boost_multiplier?: number;
          boost_radius_km?: number;
          boost_zone_types?: string[];
          capacity?: number;
          category?: string;
          city_id?: string;
          created_at?: string;
          demand_impact?: number;
          end_at?: string;
          id?: string;
          is_holiday?: boolean;
          latitude?: number;
          longitude?: number;
          name?: string;
          start_at?: string;
          venue?: string;
        };
        Relationships: [
          {
            foreignKeyName: "events_city_id_fkey";
            columns: ["city_id"];
            isOneToOne: false;
            referencedRelation: "cities";
            referencedColumns: ["id"];
          },
        ];
      };
      gas_station_hours: {
        Row: {
          address: string | null;
          brand: string | null;
          city: string | null;
          lat: number;
          lng: number;
          match_distance_m: number | null;
          matched_name: string | null;
          periods: Json | null;
          resolved_at: string;
          source: string;
          station_key: string;
        };
        Insert: {
          address?: string | null;
          brand?: string | null;
          city?: string | null;
          lat: number;
          lng: number;
          match_distance_m?: number | null;
          matched_name?: string | null;
          periods?: Json | null;
          resolved_at?: string;
          source?: string;
          station_key: string;
        };
        Update: {
          address?: string | null;
          brand?: string | null;
          city?: string | null;
          lat?: number;
          lng?: number;
          match_distance_m?: number | null;
          matched_name?: string | null;
          periods?: Json | null;
          resolved_at?: string;
          source?: string;
          station_key?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          created_at: string;
          id: string;
          message: string;
          metadata: Json | null;
          read_at: string | null;
          title: string;
          type: string;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          message: string;
          metadata?: Json | null;
          read_at?: string | null;
          title: string;
          type: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          message?: string;
          metadata?: Json | null;
          read_at?: string | null;
          title?: string;
          type?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      platform_signals: {
        Row: {
          captured_at: string;
          content_hash: string | null;
          created_at: string;
          demand_level: number;
          estimated_wait_min: number | null;
          id: string;
          nearby_drivers_count: number | null;
          platform: string;
          source: string;
          surge_active: boolean;
          surge_multiplier: number | null;
          zone_id: string;
        };
        Insert: {
          captured_at?: string;
          content_hash?: string | null;
          created_at?: string;
          demand_level?: number;
          estimated_wait_min?: number | null;
          id?: string;
          nearby_drivers_count?: number | null;
          platform: string;
          source?: string;
          surge_active?: boolean;
          surge_multiplier?: number | null;
          zone_id: string;
        };
        Update: {
          captured_at?: string;
          content_hash?: string | null;
          created_at?: string;
          demand_level?: number;
          estimated_wait_min?: number | null;
          id?: string;
          nearby_drivers_count?: number | null;
          platform?: string;
          source?: string;
          surge_active?: boolean;
          surge_multiplier?: number | null;
          zone_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "platform_signals_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
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
          id?: never;
          predicted_at: string;
          predicted_score: number;
          prediction_error?: number | null;
          zone_id: string;
        };
        Update: {
          actual_earnings_per_hour?: number | null;
          created_at?: string;
          factors_snapshot?: Json | null;
          id?: never;
          predicted_at?: string;
          predicted_score?: number;
          prediction_error?: number | null;
          zone_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "predictions_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
          },
        ];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          driver_id: string | null;
          endpoint: string;
          id: string;
          p256dh: string;
          updated_at: string;
          user_agent: string | null;
        };
        Insert: {
          auth: string;
          created_at?: string;
          driver_id?: string | null;
          endpoint: string;
          id?: string;
          p256dh: string;
          updated_at?: string;
          user_agent?: string | null;
        };
        Update: {
          auth?: string;
          created_at?: string;
          driver_id?: string | null;
          endpoint?: string;
          id?: string;
          p256dh?: string;
          updated_at?: string;
          user_agent?: string | null;
        };
        Relationships: [];
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
            foreignKeyName: "scores_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
          },
        ];
      };
      screenshot_uploads: {
        Row: {
          analysis_result: Json | null;
          analyzed_at: string | null;
          content_hash: string;
          file_name: string | null;
          file_path: string;
          file_size_bytes: number | null;
          id: string;
          mime_type: string | null;
          notes: string | null;
          source: string;
          trip_id: string | null;
          uploaded_at: string;
          user_id: string;
        };
        Insert: {
          analysis_result?: Json | null;
          analyzed_at?: string | null;
          content_hash: string;
          file_name?: string | null;
          file_path: string;
          file_size_bytes?: number | null;
          id?: string;
          mime_type?: string | null;
          notes?: string | null;
          source?: string;
          trip_id?: string | null;
          uploaded_at?: string;
          user_id: string;
        };
        Update: {
          analysis_result?: Json | null;
          analyzed_at?: string | null;
          content_hash?: string;
          file_name?: string | null;
          file_path?: string;
          file_size_bytes?: number | null;
          id?: string;
          mime_type?: string | null;
          notes?: string | null;
          source?: string;
          trip_id?: string | null;
          uploaded_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "screenshot_uploads_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: false;
            referencedRelation: "trips";
            referencedColumns: ["id"];
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
          id?: never;
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
          id?: never;
          predicted_score?: number | null;
          rides_count?: number;
          session_id?: number;
          zone_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "session_zones_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "session_zones_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
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
          user_id: string | null;
          weather_snapshot: Json | null;
        };
        Insert: {
          created_at?: string;
          ended_at?: string | null;
          id?: never;
          notes?: string | null;
          started_at: string;
          total_earnings?: number | null;
          total_hours?: number | null;
          total_rides?: number | null;
          user_id?: string | null;
          weather_snapshot?: Json | null;
        };
        Update: {
          created_at?: string;
          ended_at?: string | null;
          id?: never;
          notes?: string | null;
          started_at?: string;
          total_earnings?: number | null;
          total_hours?: number | null;
          total_rides?: number | null;
          user_id?: string | null;
          weather_snapshot?: Json | null;
        };
        Relationships: [];
      };
      stripe_events: {
        Row: {
          created_at: string;
          event_type: string;
          id: string;
          payload: Json | null;
          processed: boolean | null;
          stripe_event_id: string;
        };
        Insert: {
          created_at?: string;
          event_type: string;
          id?: string;
          payload?: Json | null;
          processed?: boolean | null;
          stripe_event_id: string;
        };
        Update: {
          created_at?: string;
          event_type?: string;
          id?: string;
          payload?: Json | null;
          processed?: boolean | null;
          stripe_event_id?: string;
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
          user_id: string | null;
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
          user_id?: string | null;
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
          user_id?: string | null;
          zone_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "time_slots_city_id_fkey";
            columns: ["city_id"];
            isOneToOne: false;
            referencedRelation: "cities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_slots_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
          },
        ];
      };
      trip_predictions: {
        Row: {
          abs_error: number | null;
          actual_earnings_per_h: number | null;
          context_vector_id: string | null;
          created_at: string;
          day_of_week: number | null;
          error: number | null;
          hour_of_day: number | null;
          id: string;
          predicted_earnings_per_h: number | null;
          shift_date: string | null;
          trip_id: string | null;
          zone_id: string | null;
          zone_score_at_start: number | null;
        };
        Insert: {
          abs_error?: number | null;
          actual_earnings_per_h?: number | null;
          context_vector_id?: string | null;
          created_at?: string;
          day_of_week?: number | null;
          error?: number | null;
          hour_of_day?: number | null;
          id?: string;
          predicted_earnings_per_h?: number | null;
          shift_date?: string | null;
          trip_id?: string | null;
          zone_id?: string | null;
          zone_score_at_start?: number | null;
        };
        Update: {
          abs_error?: number | null;
          actual_earnings_per_h?: number | null;
          context_vector_id?: string | null;
          created_at?: string;
          day_of_week?: number | null;
          error?: number | null;
          hour_of_day?: number | null;
          id?: string;
          predicted_earnings_per_h?: number | null;
          shift_date?: string | null;
          trip_id?: string | null;
          zone_id?: string | null;
          zone_score_at_start?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "trip_predictions_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: false;
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trip_predictions_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
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
          source: string;
          started_at: string;
          tips: number | null;
          user_id: string | null;
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
          source?: string;
          started_at?: string;
          tips?: number | null;
          user_id?: string | null;
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
          source?: string;
          started_at?: string;
          tips?: number | null;
          user_id?: string | null;
          zone_id?: string | null;
          zone_score?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "trips_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
          },
        ];
      };
      trips_raw: {
        Row: {
          bonus_cad: number | null;
          created_at: string | null;
          distance_km: number | null;
          driver_id: string | null;
          dropoff_lat: number | null;
          dropoff_lng: number | null;
          duration_min: number | null;
          fare_cad: number | null;
          id: string;
          pickup_lat: number | null;
          pickup_lng: number | null;
          platform: string | null;
          raw_data: Json | null;
          started_at: string;
          tip_cad: number | null;
          wait_min: number | null;
          zone_id: string | null;
        };
        Insert: {
          bonus_cad?: number | null;
          created_at?: string | null;
          distance_km?: number | null;
          driver_id?: string | null;
          dropoff_lat?: number | null;
          dropoff_lng?: number | null;
          duration_min?: number | null;
          fare_cad?: number | null;
          id?: string;
          pickup_lat?: number | null;
          pickup_lng?: number | null;
          platform?: string | null;
          raw_data?: Json | null;
          started_at: string;
          tip_cad?: number | null;
          wait_min?: number | null;
          zone_id?: string | null;
        };
        Update: {
          bonus_cad?: number | null;
          created_at?: string | null;
          distance_km?: number | null;
          driver_id?: string | null;
          dropoff_lat?: number | null;
          dropoff_lng?: number | null;
          duration_min?: number | null;
          fare_cad?: number | null;
          id?: string;
          pickup_lat?: number | null;
          pickup_lng?: number | null;
          platform?: string | null;
          raw_data?: Json | null;
          started_at?: string;
          tip_cad?: number | null;
          wait_min?: number | null;
          zone_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "trips_raw_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
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
            foreignKeyName: "user_pings_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
          },
        ];
      };
      user_profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string | null;
          full_name: string | null;
          id: string;
          onboarding_completed: boolean | null;
          preferred_zones: string[] | null;
          stripe_current_period_end: string | null;
          stripe_customer_id: string | null;
          stripe_price_id: string | null;
          stripe_subscription_id: string | null;
          subscription_status: string | null;
          updated_at: string;
          user_id: string;
          vehicle_type: string | null;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          full_name?: string | null;
          id?: string;
          onboarding_completed?: boolean | null;
          preferred_zones?: string[] | null;
          stripe_current_period_end?: string | null;
          stripe_customer_id?: string | null;
          stripe_price_id?: string | null;
          stripe_subscription_id?: string | null;
          subscription_status?: string | null;
          updated_at?: string;
          user_id: string;
          vehicle_type?: string | null;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          full_name?: string | null;
          id?: string;
          onboarding_completed?: boolean | null;
          preferred_zones?: string[] | null;
          stripe_current_period_end?: string | null;
          stripe_customer_id?: string | null;
          stripe_price_id?: string | null;
          stripe_subscription_id?: string | null;
          subscription_status?: string | null;
          updated_at?: string;
          user_id?: string;
          vehicle_type?: string | null;
        };
        Relationships: [];
      };
      weight_history: {
        Row: {
          accuracy_pct: number | null;
          created_at: string;
          id: number;
          mae: number | null;
          note: string | null;
          prediction_mae: number | null;
          source: string;
          triggered_by: string;
          trip_count: number;
          w_day: number;
          w_events: number;
          w_historical: number;
          w_time: number;
          w_weather: number;
          weights: Json;
        };
        Insert: {
          accuracy_pct?: number | null;
          created_at?: string;
          id?: never;
          mae?: number | null;
          note?: string | null;
          prediction_mae?: number | null;
          source?: string;
          triggered_by?: string;
          trip_count?: number;
          w_day?: number;
          w_events?: number;
          w_historical?: number;
          w_time?: number;
          w_weather?: number;
          weights: Json;
        };
        Update: {
          accuracy_pct?: number | null;
          created_at?: string;
          id?: never;
          mae?: number | null;
          note?: string | null;
          prediction_mae?: number | null;
          source?: string;
          triggered_by?: string;
          trip_count?: number;
          w_day?: number;
          w_events?: number;
          w_historical?: number;
          w_time?: number;
          w_weather?: number;
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
            foreignKeyName: "zone_beliefs_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
          },
        ];
      };
      zone_context_vectors: {
        Row: {
          actual_earnings_per_hour: number | null;
          captured_at: string;
          context_vector: string;
          id: string;
          surge_class: string;
          surge_multiplier: number;
          trip_count: number;
          zone_id: string;
        };
        Insert: {
          actual_earnings_per_hour?: number | null;
          captured_at?: string;
          context_vector: string;
          id?: string;
          surge_class?: string;
          surge_multiplier?: number;
          trip_count?: number;
          zone_id: string;
        };
        Update: {
          actual_earnings_per_hour?: number | null;
          captured_at?: string;
          context_vector?: string;
          id?: string;
          surge_class?: string;
          surge_multiplier?: number;
          trip_count?: number;
          zone_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "zone_context_vectors_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
          },
        ];
      };
      zone_discoveries: {
        Row: {
          address: string;
          city_hint: string | null;
          context: string;
          count: number;
          first_seen_at: string;
          id: string;
          last_seen_at: string;
          latitude: number | null;
          longitude: number | null;
          notes: string | null;
          promoted_zone_id: string | null;
          status: string;
          user_id: string | null;
        };
        Insert: {
          address: string;
          city_hint?: string | null;
          context: string;
          count?: number;
          first_seen_at?: string;
          id?: string;
          last_seen_at?: string;
          latitude?: number | null;
          longitude?: number | null;
          notes?: string | null;
          promoted_zone_id?: string | null;
          status?: string;
          user_id?: string | null;
        };
        Update: {
          address?: string;
          city_hint?: string | null;
          context?: string;
          count?: number;
          first_seen_at?: string;
          id?: string;
          last_seen_at?: string;
          latitude?: number | null;
          longitude?: number | null;
          notes?: string | null;
          promoted_zone_id?: string | null;
          status?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "zone_discoveries_city_hint_fkey";
            columns: ["city_hint"];
            isOneToOne: false;
            referencedRelation: "cities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "zone_discoveries_promoted_zone_id_fkey";
            columns: ["promoted_zone_id"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
          },
        ];
      };
      zone_performance: {
        Row: {
          avg_distance_km: number | null;
          avg_fare_cad: number | null;
          avg_wait_min: number | null;
          day_of_week: number | null;
          demand_score: number | null;
          hour_of_day: number | null;
          id: string;
          platform: string | null;
          trip_count: number | null;
          updated_at: string | null;
          zone_id: string | null;
        };
        Insert: {
          avg_distance_km?: number | null;
          avg_fare_cad?: number | null;
          avg_wait_min?: number | null;
          day_of_week?: number | null;
          demand_score?: number | null;
          hour_of_day?: number | null;
          id?: string;
          platform?: string | null;
          trip_count?: number | null;
          updated_at?: string | null;
          zone_id?: string | null;
        };
        Update: {
          avg_distance_km?: number | null;
          avg_fare_cad?: number | null;
          avg_wait_min?: number | null;
          day_of_week?: number | null;
          demand_score?: number | null;
          hour_of_day?: number | null;
          id?: string;
          platform?: string | null;
          trip_count?: number | null;
          updated_at?: string | null;
          zone_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "zone_performance_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "zones";
            referencedColumns: ["id"];
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
          type: Database["public"]["Enums"]["zone_type"];
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          base_score?: number | null;
          category?: string | null;
          city_id: string;
          created_at?: string;
          current_score?: number | null;
          id: string;
          latitude: number;
          longitude: number;
          name: string;
          territory?: string | null;
          type?: Database["public"]["Enums"]["zone_type"];
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
          type?: Database["public"]["Enums"]["zone_type"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "zones_city_id_fkey";
            columns: ["city_id"];
            isOneToOne: false;
            referencedRelation: "cities";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      my_subscription: {
        Row: {
          is_active: boolean | null;
          stripe_current_period_end: string | null;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          subscription_status: string | null;
          user_id: string | null;
        };
        Insert: {
          is_active?: never;
          stripe_current_period_end?: string | null;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          subscription_status?: string | null;
          user_id?: string | null;
        };
        Update: {
          is_active?: never;
          stripe_current_period_end?: string | null;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          subscription_status?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      aggregate_zone_performance: { Args: never; Returns: undefined };
      cleanup_old_context_vectors: { Args: never; Returns: undefined };
      cleanup_old_platform_signals: { Args: never; Returns: undefined };
      cleanup_old_weight_history: { Args: never; Returns: undefined };
      find_similar_contexts: {
        Args: {
          p_limit?: number;
          p_min_trips?: number;
          p_vector: string;
          p_zone_id: string;
        };
        Returns: {
          actual_earnings_per_hour: number;
          captured_at: string;
          id: string;
          similarity: number;
          surge_class: string;
          surge_multiplier: number;
          trip_count: number;
          zone_id: string;
        }[];
      };
      get_best_platform_for_zone: {
        Args: { p_lookback?: string; p_zone_id: string };
        Returns: {
          avg_demand: number;
          latest_multiplier: number;
          latest_surge: boolean;
          platform: string;
          signal_count: number;
        }[];
      };
      get_latest_scores: {
        Args: { p_city_id: string };
        Returns: {
          calculated_at: string;
          event_boost: number | null;
          final_score: number | null;
          id: string;
          score: number | null;
          weather_boost: number | null;
          zone_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "scores";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      get_latest_weights: {
        Args: never;
        Returns: {
          calibrated_at: string;
          mae: number;
          w_day: number;
          w_events: number;
          w_historical: number;
          w_time: number;
          w_weather: number;
        }[];
      };
      get_platform_signals_by_zone: {
        Args: { p_city_id: string; p_lookback?: string };
        Returns: {
          captured_at: string;
          demand_level: number;
          platform: string;
          surge_active: boolean;
          zone_id: string;
        }[];
      };
      get_surge_baseline: {
        Args: { p_dow: number; p_hour_slot: number; p_zone_id: string };
        Returns: number;
      };
      get_weight_calibration_summary: {
        Args: { p_limit?: number };
        Returns: {
          accuracy_pct: number;
          created_at: string;
          mae: number;
          trip_count: number;
          w_day: number;
          w_events: number;
          w_historical: number;
          w_time: number;
          w_weather: number;
        }[];
      };
      increment_rate_limit: {
        Args: { p_fn: string; p_window_start: string };
        Returns: number;
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
      match_user_pings: {
        Args: {
          match_count?: number;
          query_driver_fingerprint: string;
          query_platform?: string;
          query_vector: string;
          query_zone_id?: string;
        };
        Returns: {
          created_at: string;
          id: string;
          similarity: number;
          success_score: number;
          zone_id: string;
        }[];
      };
      recalculate_zone_scores: { Args: never; Returns: undefined };
    };
    Enums: {
      zone_type:
        | "métro"
        | "commercial"
        | "résidentiel"
        | "nightlife"
        | "aéroport"
        | "transport"
        | "médical"
        | "université"
        | "événements"
        | "tourisme";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      zone_type: [
        "métro",
        "commercial",
        "résidentiel",
        "nightlife",
        "aéroport",
        "transport",
        "médical",
        "université",
        "événements",
        "tourisme",
      ],
    },
  },
} as const;
