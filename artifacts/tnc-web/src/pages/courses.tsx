import { useGetCourses, useGetPromoStatus, useGetUserPurchases, getGetUserPurchasesQueryKey } from "@/lib/api-client";
import { Link } from "wouter";
import { BookOpen, Lock, Unlock, ArrowRight, Search, Heart, Flame } from "lucide-react";
import { useState, useEffect } from "react";
import Layout from "@/components/Layout";
import { getUser } from "@/lib/auth";
import { motion } from "framer-motion";
import { toggleFavorite, getFavorites } from "@/lib/streak";
import { BATCH_THUMBNAIL_URL } from "@/lib/course-media";
import CoursePrice from "@/components/CoursePrice";

const PAGE_SIZE = 18;

function isNewCourse(createdAt: string | undefined | null): boolean {
  if (!createdAt) return false;
  const d = new Date(createdAt);
  const diffDays = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays <= 30;
}

export default function CoursesPage() {
  const user = getUser();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"all" | "favorites">("all");
  const [page, setPage] = useState(1);
  const [favIds, setFavIds] = useState<string[]>([]);

  useEffect(() => {
    const syncFavorites = () => setFavIds(getFavorites("courses"));
    syncFavorites();
    window.addEventListener("tnc-site-activity-updated", syncFavorites);
    window.addEventListener("storage", syncFavorites);
    return () => {
      window.removeEventListener("tnc-site-activity-updated", syncFavorites);
      window.removeEventListener("storage", syncFavorites);
    };
  }, []);

  const { data: courses, isLoading } = useGetCourses();
  const { data: promo } = useGetPromoStatus();
  const { data: purchases } = useGetUserPurchases(user?.userId ?? "", {
    query: { enabled: !!user, queryKey: getGetUserPurchasesQueryKey(user?.userId ?? "") },
  });

  const courseList = Array.isArray(courses) ? courses : [];
  const purchaseList = Array.isArray(purchases) ? purchases : [];
  const purchasedCourseIds = new Set(purchaseList.map((p) => p.courseId));

  function isUnlocked(courseRowId: string) {
    return promo?.enabled || purchasedCourseIds.has(courseRowId);
  }

  function handleFav(id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = toggleFavorite("courses", id);
    setFavIds((prev) => next ? [...prev, id] : prev.filter((x) => x !== id));
  }

  const searched = courseList.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const filtered = tab === "favorites"
    ? searched.filter((c) => favIds.includes(c.rowId))
    : searched;

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = page * PAGE_SIZE < filtered.length;

  return (
    <Layout>
      <div className="tnc-brand-gradient text-white py-10 px-4">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-2xl md:text-3xl font-black mb-1">All Courses</h1>
          <p className="text-white/70 text-sm">
            {courseList.length > 0 ? `${courseList.length} courses — newest on top` : "Choose a batch and start your exam preparation"}
          </p>
        </div>
      </div>

      {/* Search + tabs */}
      <div className="bg-white border-b sticky top-16 z-30">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search courses..."
              className="w-full pl-9 pr-4 py-2 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              data-testid="input-search-courses"
            />
          </div>
          <div className="flex gap-1">
            {(["all", "favorites"] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setPage(1); }}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                  tab === t ? "bg-blue-600 text-white" : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {t === "favorites" && <Heart size={11} className={tab === "favorites" ? "fill-white" : ""} />}
                {t === "all" ? "All" : `Saved (${favIds.length})`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="max-w-5xl mx-auto px-4 py-8">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="bg-white rounded-2xl overflow-hidden border">
                <div className="h-44 skeleton" />
                <div className="p-4 space-y-2">
                  <div className="h-4 skeleton rounded w-3/4" />
                  <div className="h-3 skeleton rounded w-full" />
                  <div className="h-9 skeleton rounded mt-3" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <BookOpen size={48} className="mx-auto text-gray-200 mb-3" />
            <p className="font-medium">
              {tab === "favorites" ? "No saved courses yet" : "No courses found"}
            </p>
            {tab === "favorites" && (
              <p className="text-sm mt-1 text-gray-400">Tap the ❤ button on any course to save it here</p>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {paged.map((course, i) => {
                const unlocked = isUnlocked(course.rowId);
                const isNew = isNewCourse(course.createdAt);
                const isFav = favIds.includes(course.rowId);
                return (
                  <motion.div
                    key={course.rowId}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.04, 0.6) }}
                    className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-shadow border border-gray-100 group flex flex-col"
                    data-testid={`card-course-${course.rowId}`}
                  >
                    <div className="relative h-44 overflow-hidden bg-gradient-to-br from-blue-50 to-indigo-100">
                      <img
                        src={BATCH_THUMBNAIL_URL}
                        alt={course.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      {/* Badges */}
                      <div className="absolute top-3 left-3 flex gap-1.5">
                        {isNew && (
                          <span className="flex items-center gap-0.5 bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                            <Flame size={9} /> NEW
                          </span>
                        )}
                      </div>
                      <div className="absolute top-3 right-3 flex items-center gap-1.5">
                        <button
                          onClick={(e) => handleFav(course.rowId, e)}
                          className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                            isFav ? "bg-red-500 text-white" : "bg-black/40 text-white hover:bg-black/60"
                          }`}
                          title={isFav ? "Remove from saved" : "Save course"}
                        >
                          <Heart size={12} className={isFav ? "fill-white" : ""} />
                        </button>
                        <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${
                          unlocked ? "bg-green-500 text-white" : "bg-gray-900/70 text-white"
                        }`}>
                          {unlocked ? <Unlock size={11} /> : <Lock size={11} />}
                          {unlocked ? "Unlocked" : "Locked"}
                        </div>
                      </div>
                    </div>

                    <div className="p-4 flex flex-col flex-1">
                      <h3 className="font-bold text-gray-900 text-sm leading-snug mb-1 line-clamp-2">{course.name}</h3>
                      {course.description && course.description !== "Description" && (
                        <p className="text-xs text-gray-500 line-clamp-2 mb-2">{course.description}</p>
                      )}
                      <CoursePrice price={course.price} />
                      <div className="flex gap-2 mt-auto pt-3">
                        <Link
                          href={`/courses/${course.rowId}`}
                          className="flex-1 flex items-center justify-center gap-1 py-2 px-3 rounded-lg text-xs font-semibold text-white tnc-brand-gradient hover:opacity-90 transition-opacity"
                          data-testid={`btn-view-${course.rowId}`}
                        >
                          View Content <ArrowRight size={12} />
                        </Link>
                        {!unlocked && (
                          <Link
                            href="/buy"
                            className="flex items-center justify-center px-3 py-2 rounded-lg text-xs font-semibold border border-amber-500 text-amber-600 hover:bg-amber-50 transition-colors"
                            data-testid={`btn-buy-${course.rowId}`}
                          >
                            Buy
                          </Link>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {hasMore && (
              <div className="flex justify-center mt-8">
                <button
                  onClick={() => setPage((p) => p + 1)}
                  className="px-6 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm"
                >
                  Load more ({filtered.length - paged.length} remaining)
                </button>
              </div>
            )}

            <p className="text-center text-xs text-gray-400 mt-4">
              Showing {paged.length} of {filtered.length} courses
            </p>
          </>
        )}
      </div>
    </Layout>
  );
}
