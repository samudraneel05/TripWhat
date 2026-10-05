import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { authApi, tripsApi } from "../lib/api";
import { toast } from "react-toastify";
import { User, Mail, Calendar, MapPin, Save, LogOut, Compass } from "lucide-react";

const ProfilePage = () => {
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [statistics, setStatistics] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);

  const [profileData, setProfileData] = useState({
    name: "",
    email: "",
    bio: "",
    avatarUrl: "",
    preferences: {
      budget: "mid-range",
      travelStyle: "cultural",
      interests: [],
    },
  });

  useEffect(() => {
    if (user) {
      setProfileData({
        name: user.name || "",
        email: user.email || "",
        bio: user.bio || "",
        avatarUrl: user.avatarUrl || `https://api.dicebear.com/7.x/adventurer/svg?seed=${user.name || "User"}`,
        preferences: {
          budget: user.preferences?.budget || "mid-range",
          travelStyle: user.preferences?.travelStyle || "cultural",
          interests: user.preferences?.interests || [],
        },
      });
    }
    fetchStatistics();
  }, [user]);

  const fetchStatistics = async () => {
    try {
      setLoadingStats(true);
      const res = await tripsApi.statistics();
      if (res.data?.statistics) setStatistics(res.data.statistics);
    } catch (err) {
      console.error("Failed to load statistics:", err);
    } finally {
      setLoadingStats(false);
    }
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const res = await authApi.updateProfile({
        name: profileData.name?.trim(),
        bio: profileData.bio?.trim(),
        avatarUrl: profileData.avatarUrl,
        preferences: profileData.preferences,
      });
      if (updateUser && res.data?.user) updateUser(res.data.user);
      toast.success("Profile updated successfully!");
    } catch (err) {
      toast.error(err.message || "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  useEffect(() => {
    if (!user) {
      navigate("/login");
    }
  }, [user, navigate]);

  if (!user) {
    return null;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <main className="max-w-xl mx-auto px-6 py-8">
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full overflow-hidden border border-[var(--border)]">
            <img src={profileData.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-xl font-semibold text-[var(--ink)] tracking-tight">My profile</h1>
        </div>

        {statistics && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[
              { label: "Days traveled", value: statistics.totalDaysTraveled || 0, icon: Calendar },
              { label: "Cities visited", value: statistics.citiesVisited || 0, icon: MapPin },
              { label: "Countries", value: statistics.countriesVisited || 0, icon: Compass },
            ].map((stat, i) => (
              <div key={i} className="rounded-lg bg-[var(--surface)] border border-[var(--border)] p-3 text-center">
                <stat.icon className="w-4 h-4 text-[var(--muted)] mx-auto mb-1.5" />
                <p className="text-lg font-semibold text-[var(--ink)]">{stat.value}</p>
                <p className="text-[10px] text-[var(--muted)]">{stat.label}</p>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-xl bg-[var(--surface)] border border-[var(--border)] p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--ink)] flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-[var(--muted)]" /> Name
            </label>
            <input
              type="text"
              value={profileData.name}
              onChange={(e) => setProfileData((p) => ({ ...p, name: e.target.value }))}
              className="w-full h-10 px-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--muted)] transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--ink)] flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-[var(--muted)]" /> Email
            </label>
            <input
              type="email"
              value={profileData.email}
              disabled
              className="w-full h-10 px-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--muted)] cursor-not-allowed"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--ink)]">Bio</label>
            <textarea
              value={profileData.bio}
              onChange={(e) => setProfileData((p) => ({ ...p, bio: e.target.value }))}
              placeholder="Tell us about your travel style..."
              rows={3}
              maxLength={500}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--muted)] transition-colors resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--ink)]">Budget preference</label>
            <div className="grid grid-cols-3 gap-1.5">
              {["budget", "mid-range", "luxury"].map((level) => (
                <button
                  key={level}
                  onClick={() => setProfileData((p) => ({ ...p, preferences: { ...p.preferences, budget: level } }))}
                  className={`px-3 py-1.5 rounded-md text-xs capitalize transition-colors ${
                    profileData.preferences.budget === level
                      ? "bg-[var(--ink)] text-white font-medium"
                      : "bg-[var(--bg)] text-[var(--ink)] hover:bg-[var(--sage)]"
                  }`
                }
                >
                  {level === "mid-range" ? "Mid-range" : level}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--ink)]">Travel style</label>
            <div className="grid grid-cols-2 gap-1.5">
              {["adventure", "relaxation", "cultural", "business"].map((style) => (
                <button
                  key={style}
                  onClick={() => setProfileData((p) => ({ ...p, preferences: { ...p.preferences, travelStyle: style } }))}
                  className={`px-3 py-1.5 rounded-md text-xs capitalize transition-colors ${
                    profileData.preferences.travelStyle === style
                      ? "bg-[var(--ink)] text-white font-medium"
                      : "bg-[var(--bg)] text-[var(--ink)] hover:bg-[var(--sage)]"
                  }`
                }
                >
                  {style}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--ink)]">Interests</label>
            <div className="flex flex-wrap gap-1.5">
              {["museums", "nightlife", "nature", "food", "shopping", "history", "art"].map((interest) => (
                <button
                  key={interest}
                  onClick={() => {
                    const interests = profileData.preferences.interests || [];
                    const newInterests = interests.includes(interest)
                      ? interests.filter((i) => i !== interest)
                      : [...interests, interest];
                    setProfileData((p) => ({ ...p, preferences: { ...p.preferences, interests: newInterests } }));
                  }}
                  className={`px-2.5 py-1 rounded-md text-xs capitalize transition-colors ${
                    (profileData.preferences.interests || []).includes(interest)
                      ? "bg-[var(--lavender)] text-[var(--ink)] font-medium"
                      : "bg-[var(--bg)] text-[var(--muted)] hover:bg-[var(--sage)]"
                  }`
                }
                >
                  {interest}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleSaveProfile}
            disabled={saving}
            className="w-full h-10 rounded-lg bg-[var(--ink)] text-white text-sm font-medium hover:bg-[#292524] transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? "Saving..." : "Save changes"}
          </button>

          <div className="border-t border-[var(--border)] pt-4">
            <button
              onClick={handleLogout}
              className="w-full h-10 rounded-lg border border-[var(--border)] text-[var(--muted)] text-sm font-medium hover:bg-red-50 hover:text-red-500 transition-colors flex items-center justify-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ProfilePage;