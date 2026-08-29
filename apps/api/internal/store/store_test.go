package store

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/vndee/tuhoc-api/migrations"
)

// TestTestPool_MigratesAndSeedsNoCourse is the store package's own
// integration test, and doubles as the first exercise of TestPool — the
// helper every later backend package (auth, sync, stats) uses to get a
// migrated, ready-to-query pool in its own tests. It spins up a real
// postgres:16-alpine container, runs MigrateUp against it, and checks that
// a fully migrated database carries NO course rows.
//
// It used to assert the opposite — one seeded row — because 0001_init
// seeded the author's private textbook into `courses`. That row was
// metadata about a private work baked into every database of everyone who
// ever self-hosted this platform, and rewriting git history would not have
// touched it (S1 review, C2d). 0001 no longer seeds and 0003 deletes what
// it seeded, so the assertion flips with it.
//
// The direction matters: asserting `count == 0` is what makes a re-added
// seed row fail here rather than ship. `count >= 0` would pass either way.
func TestTestPool_MigratesAndSeedsNoCourse(t *testing.T) {
	pool := TestPool(t)

	var count int
	err := pool.QueryRow(context.Background(), "SELECT count(*) FROM courses").Scan(&count)
	if err != nil {
		t.Fatalf("query courses count: %v", err)
	}

	if count != 0 {
		t.Fatalf("want 0 seeded courses (the platform ships no content), got %d", count)
	}
}

// TestMigration0008BootstrapsCreditExactlyOnce là cổng của A1+A2 (review
// tổng nhánh Pha 2). Nó đi qua ĐÚNG đường mà một cài đặt đang chạy sẽ đi:
// dừng ở version 7, tạo dữ liệu như một hệ thống đã sống, rồi mới lên 8.
// Một test chỉ chạy MigrateUp một phát trên DB trống không thể phân biệt
// "0008 backfill đúng" với "0008 không làm gì cả", vì trên DB trống cả hai
// cho cùng kết quả: không có tài khoản nào để backfill.
//
// Ba khẳng định, theo thứ tự:
//
//  1. 0007 một mình để lại signup_grant_micro = 0 (tiền đề của A1 — nếu
//     dòng này đỏ thì tiền đề đã đổi và cả migration cần nghĩ lại).
//  2. 0008 đặt grant và backfill ĐÚNG những tài khoản chưa có hàng, KHÔNG
//     đụng tới số dư đã tồn tại.
//  3. Chạy LẠI không nhân đôi — đo hai cách độc lập: golang-migrate từ
//     chối chạy lại (ErrNoChange), VÀ chính nội dung tệp 0008 thi hành lần
//     thứ hai bằng tay cho ra trạng thái y hệt. Cách thứ hai mới là cách
//     chứng minh SQL tự nó idempotent; cách thứ nhất chỉ chứng minh bảng
//     schema_migrations đang làm việc của nó.
func TestMigration0008BootstrapsCreditExactlyOnce(t *testing.T) {
	ctx := context.Background()

	container, err := tcpostgres.Run(ctx, "postgres:16-alpine",
		tcpostgres.WithDatabase("tuhoc_test"),
		tcpostgres.WithUsername("tuhoc"),
		tcpostgres.WithPassword("tuhoc"),
		tcpostgres.BasicWaitStrategies(),
	)
	if err != nil {
		t.Fatalf("start postgres container: %v", err)
	}
	t.Cleanup(func() {
		if err := testcontainers.TerminateContainer(container); err != nil {
			t.Logf("terminate postgres container: %v", err)
		}
	})
	databaseURL, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("connection string: %v", err)
	}

	src, err := iofs.New(migrations.FS, ".")
	if err != nil {
		t.Fatalf("load embedded migrations: %v", err)
	}
	m, err := migrate.NewWithSourceInstance("iofs", src, pgx5URL(databaseURL))
	if err != nil {
		t.Fatalf("init migrator: %v", err)
	}
	t.Cleanup(func() { _, _ = m.Close() })

	// ── dừng ở 7: chính xác trạng thái của một cài đặt đã deploy Pha 2 ──
	if err := m.Migrate(7); err != nil {
		t.Fatalf("migrate to version 7: %v", err)
	}

	pool, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	grant := func() int64 {
		t.Helper()
		var v int64
		if err := pool.QueryRow(ctx, `SELECT signup_grant_micro FROM ai_settings LIMIT 1`).Scan(&v); err != nil {
			t.Fatalf("read signup_grant_micro: %v", err)
		}
		return v
	}
	balanceOf := func(id string) int64 {
		t.Helper()
		var v int64
		if err := pool.QueryRow(ctx, `SELECT balance_micro FROM ai_credits WHERE user_id = $1`, id).Scan(&v); err != nil {
			t.Fatalf("read balance for %s: %v", id, err)
		}
		return v
	}
	creditRowCount := func() int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM ai_credits`).Scan(&n); err != nil {
			t.Fatalf("count ai_credits: %v", err)
		}
		return n
	}
	newUser := func(label string) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx,
			`INSERT INTO users (email, name, pw_hash) VALUES ($1,$2,$3) RETURNING id::text`,
			label+"@example.test", label, "not-a-real-hash").Scan(&id); err != nil {
			t.Fatalf("insert user %s: %v", label, err)
		}
		return id
	}

	if got := grant(); got != 0 {
		t.Fatalf("sau 0007 một mình, signup_grant_micro = %d, muốn 0 — tiền đề của A1 "+
			"(mọi tài khoản mới nhận 0 credit) đã đổi", got)
	}

	// Ba tài khoản "cũ": hai chưa có hàng ai_credits nào (đúng hình dạng
	// A2), một ĐÃ có hàng với số dư riêng — bao gồm một số dư mà backfill
	// tuyệt đối không được chạm vào.
	oldNoRowA := newUser("old-learner-a")
	oldNoRowB := newUser("old-learner-b")
	oldWithRow := newUser("old-learner-with-balance")
	const preexistingBalance int64 = 999_111
	if _, err := pool.Exec(ctx,
		`INSERT INTO ai_credits (user_id, balance_micro) VALUES ($1, $2)`,
		oldWithRow, preexistingBalance); err != nil {
		t.Fatalf("seed pre-existing ai_credits row: %v", err)
	}

	// ── lên 8 ──
	if err := m.Up(); err != nil {
		t.Fatalf("migrate up to 8: %v", err)
	}

	const wantGrant int64 = 50_000
	if got := grant(); got != wantGrant {
		t.Fatalf("signup_grant_micro sau 0008 = %d, muốn %d", got, wantGrant)
	}
	if got := creditRowCount(); got != 3 {
		t.Fatalf("ai_credits có %d hàng sau backfill, muốn 3 (đúng một hàng mỗi tài khoản)", got)
	}
	if got := balanceOf(oldNoRowA); got != wantGrant {
		t.Fatalf("tài khoản cũ A: balance = %d, muốn %d — backfill không tới được nó", got, wantGrant)
	}
	if got := balanceOf(oldNoRowB); got != wantGrant {
		t.Fatalf("tài khoản cũ B: balance = %d, muốn %d", got, wantGrant)
	}
	if got := balanceOf(oldWithRow); got != preexistingBalance {
		t.Fatalf("tài khoản ĐÃ CÓ hàng: balance = %d, muốn %d KHÔNG ĐỔI — backfill đã "+
			"ghi đè một số dư thật", got, preexistingBalance)
	}

	// F3: giá trị KHỞI ĐẦU của tỷ giá đúc phải nằm trên CÙNG trục thời gian
	// mà CMS ghi vào, nếu không thì mọi tài khoản đăng ký trước lần đổi grant
	// đầu tiên không truy ngược được nó nhận bao nhiêu.
	grantAudits := func() []string {
		t.Helper()
		rows, err := pool.Query(ctx,
			`SELECT note FROM admin_audit WHERE action = 'ai.settings.signup_grant'
			 AND target = 'ai_settings' ORDER BY at, id`)
		if err != nil {
			t.Fatalf("query admin_audit: %v", err)
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var n string
			if err := rows.Scan(&n); err != nil {
				t.Fatalf("scan admin_audit: %v", err)
			}
			out = append(out, n)
		}
		return out
	}
	audits := grantAudits()
	if len(audits) != 1 {
		t.Fatalf("admin_audit rows cho grant khởi đầu: muốn 1, được %d: %v", len(audits), audits)
	}
	if !strings.Contains(audits[0], "50000") {
		t.Fatalf("dòng sổ không mang CON SỐ (%q) — một thay đổi tỷ giá không có số "+
			"đính kèm thì tuần sau không đọc được", audits[0])
	}

	// ── chạy lại, cách 1: golang-migrate không có gì để làm ──
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		t.Fatalf("migrate up lần hai: %v", err)
	}

	// ── chạy lại, cách 2: thi hành CHÍNH nội dung 0008 lần thứ hai ──
	// Đây mới là phép đo "SQL tự nó idempotent". Cách 1 ở trên chỉ chứng
	// minh schema_migrations đang chặn, và một 0008 KHÔNG idempotent sẽ đi
	// qua cách 1 xanh trong khi vẫn là một quả mìn cho bất kỳ ai chạy tay,
	// khôi phục từ bản sao lưu, hay force version.
	raw, err := migrations.FS.ReadFile("0008_ai_credit_bootstrap.up.sql")
	if err != nil {
		t.Fatalf("read 0008 up file: %v", err)
	}
	if _, err := pool.Exec(ctx, string(raw)); err != nil {
		t.Fatalf("thi hành 0008 lần thứ hai: %v", err)
	}

	if got := grant(); got != wantGrant {
		t.Fatalf("signup_grant_micro sau lần chạy thứ hai = %d, muốn %d không đổi", got, wantGrant)
	}
	if got := creditRowCount(); got != 3 {
		t.Fatalf("ai_credits có %d hàng sau lần chạy thứ hai, muốn vẫn 3", got)
	}
	if got := balanceOf(oldNoRowA); got != wantGrant {
		t.Fatalf("tài khoản cũ A sau lần chạy thứ hai: balance = %d, muốn %d — "+
			"backfill đã CỘNG DỒN thay vì bỏ qua", got, wantGrant)
	}
	if got := balanceOf(oldWithRow); got != preexistingBalance {
		t.Fatalf("tài khoản đã có hàng, sau lần chạy thứ hai: balance = %d, muốn %d",
			got, preexistingBalance)
	}
	if got := grantAudits(); len(got) != 1 {
		t.Fatalf("admin_audit rows sau lần chạy thứ hai: muốn vẫn 1, được %d: %v — "+
			"dòng sổ đã bị ghi thêm cho một thay đổi không xảy ra", len(got), got)
	}
}

// TestMigration0008IsIdempotentAgainstAnOperatorsOwnGrant khẳng định nửa
// còn lại của điều kiện `WHERE signup_grant_micro = 0`: một người vận hành
// đã tự đặt con số của mình (bằng psql, hay scripts/test-e2e.sh) KHÔNG bị
// migration ghi đè. Đây không phải chi tiết trang trí — nếu 0008 UPDATE vô
// điều kiện thì mọi lần migrate sau này sẽ lặng lẽ đặt lại chính sách giá
// của người vận hành về con số dự án chọn.
func TestMigration0008IsIdempotentAgainstAnOperatorsOwnGrant(t *testing.T) {
	ctx := context.Background()

	container, err := tcpostgres.Run(ctx, "postgres:16-alpine",
		tcpostgres.WithDatabase("tuhoc_test"),
		tcpostgres.WithUsername("tuhoc"),
		tcpostgres.WithPassword("tuhoc"),
		tcpostgres.BasicWaitStrategies(),
	)
	if err != nil {
		t.Fatalf("start postgres container: %v", err)
	}
	t.Cleanup(func() {
		if err := testcontainers.TerminateContainer(container); err != nil {
			t.Logf("terminate postgres container: %v", err)
		}
	})
	databaseURL, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("connection string: %v", err)
	}
	if err := MigrateUp(databaseURL); err != nil {
		t.Fatalf("migrate up: %v", err)
	}
	pool, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	const operatorGrant int64 = 7_777
	if _, err := pool.Exec(ctx, `UPDATE ai_settings SET signup_grant_micro = $1`, operatorGrant); err != nil {
		t.Fatalf("operator sets their own grant: %v", err)
	}

	raw, err := migrations.FS.ReadFile("0008_ai_credit_bootstrap.up.sql")
	if err != nil {
		t.Fatalf("read 0008 up file: %v", err)
	}
	if _, err := pool.Exec(ctx, string(raw)); err != nil {
		t.Fatalf("re-run 0008: %v", err)
	}

	var got int64
	if err := pool.QueryRow(ctx, `SELECT signup_grant_micro FROM ai_settings LIMIT 1`).Scan(&got); err != nil {
		t.Fatalf("read signup_grant_micro: %v", err)
	}
	if got != operatorGrant {
		t.Fatalf("signup_grant_micro = %d sau khi 0008 chạy lại, muốn %d — migration đã "+
			"ghi đè lựa chọn của người vận hành", got, operatorGrant)
	}
}
