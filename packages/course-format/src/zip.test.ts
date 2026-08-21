import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_UNCOMPRESSED_BYTES } from './validate';
import { UnsafeArchiveError, packZip, unpackZip } from './zip';

const enc = (s: string) => new TextEncoder().encode(s);

// ---------------------------------------------------------------------------
// The three cases from the task brief, verbatim.
// ---------------------------------------------------------------------------

it('vòng tròn: pack rồi unpack ra đúng nội dung cũ', () => {
  const files = new Map([['manifest.json', new TextEncoder().encode('{}')]]);
  expect([...unpackZip(packZip(files))]).toEqual([...files]);
});

it('mục có ../ bị NÉM, không phải bị bỏ qua im lặng', () => {
  const evil = packZip(new Map([['../thoat.txt', new Uint8Array([1])]]));
  expect(() => unpackZip(evil)).toThrow(UnsafeArchiveError);
});

it('zip bomb: nén nhỏ nhưng giải nén vượt trần → NÉM trước khi cấp phát hết bộ nhớ', () => {
  const bomb = packZip(new Map([['big.txt', new Uint8Array(21 * 1024 * 1024)]]));
  expect(bomb.byteLength).toBeLessThan(1024 * 1024); // nén rất nhỏ
  expect(() => unpackZip(bomb)).toThrow(/TOO_LARGE|vượt trần/);
});

// ---------------------------------------------------------------------------
// Trần giải nén — ca quan trọng nhất của task này, mổ theo từng trục.
//
// `MAX_UNCOMPRESSED_BYTES` sống trong `validate.ts`, nhưng `validatePackage`
// nhận vào một Map ĐÃ giải nén: tới lúc luật đó chạy thì bom đã nổ rồi. Chốt
// thật nằm ở đây, và nó phải nằm TRONG vòng giải nén.
// ---------------------------------------------------------------------------

describe('trần giải nén được áp TRONG lúc giải nén', () => {
  it('cộng dồn qua NHIỀU mục, không phải trần cho từng mục', () => {
    // Mỗi mục 6 MiB — dưới trần. Bốn mục là 24 MiB — trên trần. Một cái trần
    // áp cho từng mục sẽ để lọt gói này.
    const six = 6 * 1024 * 1024;
    const files = new Map<string, Uint8Array>();
    for (let i = 0; i < 4; i++) files.set(`e${i}.bin`, new Uint8Array(six));
    expect(() => unpackZip(packZip(files))).toThrow(/TOO_LARGE/);
  });

  it('ĐỐI CHỨNG: đúng trần thì QUA, trần + 1 byte thì NÉM', () => {
    // Trần là một con số, không phải một quan hệ. Nếu ai đó đổi `>` thành `>=`
    // hoặc trừ đi một byte, dòng đầu đỏ; nếu ai đó bỏ hẳn chốt, dòng sau đỏ.
    const at = new Uint8Array(MAX_UNCOMPRESSED_BYTES);
    expect(unpackZip(packZip(new Map([['x.bin', at]]))).get('x.bin')?.byteLength)
      .toBe(MAX_UNCOMPRESSED_BYTES);
    const over = new Uint8Array(MAX_UNCOMPRESSED_BYTES + 1);
    expect(() => unpackZip(packZip(new Map([['x.bin', over]])))).toThrow(/TOO_LARGE/);
  });

  it('KÍCH THƯỚC KHAI BÁO TRONG HEADER LÀ LỜI KẺ TẤN CÔNG, KHÔNG PHẢI SỰ THẬT', () => {
    // Bài học của Task 1, áp vào đây: đừng quyết định dựa trên thứ kẻ tấn công
    // đặt tên được. Trường "uncompressed size" của local header là 4 byte kẻ
    // tấn công tự ghi. `unpackZip` ĐƯỢC PHÉP dùng nó để từ chối SỚM (đường tắt
    // rẻ tiền cho quả bom thật thà), nhưng không được TIN nó để chấp nhận.
    //
    // Gói dưới đây khai 1 byte và thực sự bung ra 21 MiB. Chỉ có phép đếm byte
    // THẬT trong lúc bung mới bắt được.
    const bomb = packZip(new Map([['big.txt', new Uint8Array(21 * 1024 * 1024)]]));
    const lying = lieAboutUncompressedSize(bomb, 1);
    expect(lying).not.toEqual(bomb); // phép vá thực sự đã đổi byte
    expect(() => unpackZip(lying)).toThrow(/TOO_LARGE/);
  });

  it('KHO 128 MiB KHÔNG KHAI KÍCH THƯỚC: dừng ở ~24 MiB, KHÔNG phải ở 128 MiB', { timeout: 120_000 }, () => {
    // ĐÂY là dòng phân biệt "kiểm TRONG lúc giải nén" với "kiểm SAU khi giải
    // nén" — và ba ca của đề bài KHÔNG phân biệt được. Đo, không đoán: một bản
    // dựng rơm ("unzipSync rồi cộng tổng") được viết ra trước và cho 19/31 test
    // XANH, trong đó có cả ca bom 21 MiB của đề bài. Nó xanh vì nó thật sự có
    // ném — chỉ là sau khi đã cấp phát xong 21 MiB.
    //
    // Kho này khai báo qua data descriptor nên local header KHÔNG mang kích
    // thước: đường tắt "từ chối theo kích thước khai báo" không thể nổ, chỉ còn
    // phép đếm byte thật. `bytesRead` là bằng chứng: bản đúng dừng ở 23,77 MiB
    // dù kho bung ra 128 MiB; bản "kiểm sau" báo đủ 134.217.728.
    //
    // Đo trên cùng máy, cùng quả bom, dựng bằng unzipSync (bản rơm) ở kích
    // thước 1 GiB: 9.557 ms và RSS 186 → 775 MiB. Bản này: ~210 ms, RSS phẳng.
    const bomb = streamedBomb('big.bin', 128 * 1024 * 1024);
    expect(bomb.byteLength).toBeLessThan(256 * 1024); // ~132 KB nén
    const err = catchUnsafe(() => unpackZip(bomb));
    expect(err.code).toBe('TOO_LARGE');
    expect(
      err.bytesRead,
      `đã giải nén ${(err.bytesRead / 1024 / 1024).toFixed(2)} MiB trước khi dừng`,
    ).toBeLessThan(2 * MAX_UNCOMPRESSED_BYTES);
  });

  it('ĐỐI CHỨNG cho ca trên: cùng cách dựng, kích thước lành thì đọc ĐÚNG', () => {
    // Nếu không có dòng này thì ca trên có thể xanh vì `streamedBomb` dựng ra
    // một kho hỏng chứ không phải vì cái chốt chạy đúng.
    const small = streamedBomb('big.bin', 3 * 1024 * 1024);
    const back = unpackZip(small);
    expect(back.get('big.bin')?.byteLength).toBe(3 * 1024 * 1024);
  });

  it('phần đã đọc được KHÔNG được trả về sau khi ném — không có nửa gói', () => {
    // Một cài đặt "gom hết rồi mới kiểm" dễ bị sửa thành "trả về những gì đã
    // đọc". Đó là một gói KHÁC gói người dùng đưa vào, và validatePackage sẽ
    // chấm điểm cho nó. Chỉ có ném.
    const files = new Map<string, Uint8Array>([
      ['manifest.json', enc('{}')],
      ['big.bin', new Uint8Array(MAX_UNCOMPRESSED_BYTES + 1)],
    ]);
    let caught: unknown;
    try {
      unpackZip(packZip(files));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnsafeArchiveError);
    expect((caught as UnsafeArchiveError).code).toBe('TOO_LARGE');
  });
});

// ---------------------------------------------------------------------------
// Đường dẫn — cùng một câu hỏi mà `validate.ts` đã trả lời một lần.
// ---------------------------------------------------------------------------

describe('đường dẫn thoát khỏi gói', () => {
  const cases: readonly string[] = [
    '../thoat.txt',
    'a/../../thoat.txt',
    '/tuyet-doi.txt',
    'C:\\windows\\evil.txt',
    // Cùng đường dẫn Windows, viết bằng dấu gạch chéo XUÔI. Ca ngay trên xanh
    // vì luật "có ký tự \", KHÔNG phải vì "là đường tuyệt đối" — nên nó tạo cảm
    // giác đường ổ đĩa đã được xử lý trong khi ba dòng dưới đây từng đi lọt.
    // Đo bằng đúng ngữ nghĩa Windows của Node:
    //   path.win32.resolve('C:\\pkg', 'C:/evil.txt') → "C:\\evil.txt"  ← ra khỏi gói
    //   path.win32.resolve('C:\\pkg', 'C:evil.txt')  → "C:\\pkg\\evil.txt"
    // Dạng thứ hai không thoát, nhưng nó là đường dẫn TƯƠNG ĐỐI THEO Ổ ĐĨA:
    // nghĩa của nó phụ thuộc thư mục hiện hành của ổ C: lúc giải nén. Một cái
    // tên mà ý nghĩa do máy người đọc quyết định thì không có chỗ trong gói.
    'C:/evil.txt',
    'c:/evil.txt',
    'C:evil.txt',
    'a\\b.txt',
    '',
  ];
  for (const name of cases) {
    it(`NÉM với "${name}"`, () => {
      const evil = rawZip([[name, new Uint8Array([1])]]);
      const err = catchUnsafe(() => unpackZip(evil));
      expect(err.code).toBe('PATH_ESCAPE');
      expect(err.entry).toBe(name);
    });
  }

  it('mục hợp lệ ĐỨNG TRƯỚC mục độc vẫn làm cả gói bị ném', () => {
    // Không có "trả về phần lành". Một mục xấu là cả kho xấu.
    const evil = rawZip([
      ['manifest.json', enc('{}')],
      ['../thoat.txt', new Uint8Array([1])],
    ]);
    expect(catchUnsafe(() => unpackZip(evil)).code).toBe('PATH_ESCAPE');
  });

  it('KHÔNG giải mã %2e%2e — giải mã URL là việc của người khác, và họ không được làm', () => {
    // Ghi lại giới hạn thay vì để người sau tự phát hiện: `%2e%2e/x` là một tên
    // tệp hợp lệ, không phải một đường thoát — TRỪ KHI ai đó decodeURIComponent
    // nó trước khi ghi ra đĩa. Đó là lỗi của người ghi.
    const m = unpackZip(rawZip([['%2e%2e/x.txt', enc('x')]]));
    expect([...m.keys()]).toEqual(['%2e%2e/x.txt']);
  });
});

// ---------------------------------------------------------------------------
// Nhập nhằng: hai mục cùng tên, và tệp không phải zip.
// ---------------------------------------------------------------------------

describe('kho nhập nhằng bị từ chối thay vì bị đoán', () => {
  it('hai mục TRÙNG TÊN bị NÉM — Map sẽ âm thầm chọn cái sau', () => {
    // Cổ điển: bộ kiểm định đọc mục này, trình đọc đọc mục kia. `new Map()` tự
    // nó chọn cái ghi sau mà không nói gì. Trong một kho gói khoá học, không có
    // lý do lành nào để hai mục trùng tên.
    const dup = rawZip([
      ['manifest.json', enc('{"tier":"content"}')],
      ['manifest.json', enc('{"tier":"interactive"}')],
    ]);
    const err = catchUnsafe(() => unpackZip(dup));
    expect(err.code).toBe('DUPLICATE_ENTRY');
    expect(err.entry).toBe('manifest.json');
  });

  it('trùng tên theo HOA/THƯỜNG cũng là trùng — trên APFS và NTFS đó là MỘT tệp', () => {
    // Luật `DUPLICATE_ENTRY` tồn tại để từ chối cái nhập nhằng "hai mục, một
    // tệp". So khớp phân biệt hoa thường trả lời câu hỏi đó theo ngữ nghĩa của
    // `Map`, không theo ngữ nghĩa của hệ tệp mà gói sẽ được ghi ra: macOS (APFS,
    // mặc định không phân biệt hoa thường) và Windows (NTFS) đều coi
    // `manifest.json` và `MANIFEST.JSON` là một. Người ghi ra đĩa — `tuhoc` CLI —
    // sẽ giữ cái sau; bộ kiểm định đọc cái đầu. Đúng cái bất đồng này.
    const dup = rawZip([
      ['manifest.json', enc('{"tier":"content"}')],
      ['MANIFEST.JSON', enc('{"tier":"interactive"}')],
    ]);
    const err = catchUnsafe(() => unpackZip(dup));
    expect(err.code).toBe('DUPLICATE_ENTRY');
    expect(err.entry).toBe('MANIFEST.JSON');
  });

  it('trùng tên theo CHUẨN HOÁ UNICODE cũng là trùng — hai chuỗi, một tên tệp', () => {
    // `café.txt` viết bằng NFC (é = U+00E9) và bằng NFD (e + U+0301) là hai
    // chuỗi JavaScript khác nhau in ra GIỐNG HỆT nhau, và trên macOS là cùng một
    // tệp. Một mục lục trộn hai dạng là cách viết "hai mục trùng tên" mà mắt
    // người đọc diff không thấy được.
    const nfc = 'café.txt';
    const nfd = 'café.txt';
    expect(nfc).not.toBe(nfd); // hai chuỗi thật sự khác nhau…
    expect(nfc.normalize('NFD')).toBe(nfd); // …và đúng là hai dạng của MỘT tên
    const err = catchUnsafe(() => unpackZip(rawZip([[nfc, enc('a')], [nfd, enc('b')]])));
    expect(err.code).toBe('DUPLICATE_ENTRY');
    expect(err.entry).toBe(nfd);
  });

  it('ĐỐI CHỨNG: hai tên KHÁC nhau thật thì vẫn qua, kể cả khi chỉ khác một chữ', () => {
    // Không có dòng này thì luật ở trên có thể là "từ chối mọi thứ na ná nhau".
    expect([...unpackZip(rawZip([['a.txt', enc('a')], ['ab.txt', enc('b')]])).keys()])
      .toEqual(['a.txt', 'ab.txt']);
  });

  it('rác không phải zip bị NÉM, KHÔNG trả về Map rỗng', () => {
    // `fflate.Unzip` quét tìm chữ ký local header; không thấy cái nào thì nó
    // kết thúc êm ru. Một Map rỗng đi tiếp tới `validatePackage` sẽ thành
    // EMPTY_PACKAGE — đúng là hỏng, nhưng sai lý do, và người dùng đọc được
    // "gói không có tệp nào" cho một tệp .docx đặt nhầm tên.
    expect(() => unpackZip(enc('đây không phải là tệp zip'))).toThrow(/MALFORMED/);
    expect(() => unpackZip(new Uint8Array(0))).toThrow(/MALFORMED/);
  });

  it('rác ĐỨNG TRƯỚC một zip thật cũng bị NÉM — không nhận tệp lai', () => {
    // Một tệp vừa là ảnh vừa là zip (polyglot) là công cụ để lách bộ lọc theo
    // magic number ở đầu chuỗi xử lý. Zip của gói khoá học do CLI của chính dự
    // án sinh ra và luôn bắt đầu bằng "PK\x03\x04".
    const good = packZip(new Map([['manifest.json', enc('{}')]]));
    const polyglot = new Uint8Array(4 + good.length);
    polyglot.set(enc('GIF8'), 0);
    polyglot.set(good, 4);
    expect(() => unpackZip(polyglot)).toThrow(/MALFORMED/);
  });

  it('zip bị CẮT CỤT giữa chừng bị NÉM, không trả về phần đọc được', () => {
    const good = packZip(new Map([['a.bin', new Uint8Array(200_000)]]));
    expect(() => unpackZip(good.subarray(0, good.length - 400))).toThrow(UnsafeArchiveError);
  });

  it('cắt cụt NGAY TRONG local header: mất hẳn một mục mà KHÔNG có lỗi nào — lỗ đã bịt', () => {
    // Đo được, không phải giả định. Trước khi có phép đối chiếu số mục ở cuối
    // `unpackZip`, bốn nhát cắt dưới đây đều cho `keys=["a.txt"]` và KHÔNG ném
    // gì cả: người gọi nhận về một gói NHỎ HƠN gói họ đưa vào, không dấu hiệu.
    // `fflate` bỏ qua local header cụt vì nó chưa đủ dài để đọc (`Unzip.push`:
    // `if (l > i + 30 + fnl + es)`), rồi kết thúc êm ru.
    const good = packZip(new Map([['a.txt', enc('AAAA')], ['b.txt', enc('BBBBBBBB')]]));
    const second = localHeaderOffsets(good)[1] as number;
    for (const past of [4, 10, 25, 33]) {
      const err = catchUnsafe(() => unpackZip(good.subarray(0, second + past)));
      expect(err.code, `cắt ở local header thứ 2 + ${past}`).toBe('MALFORMED');
    }
  });

  it('mất hẳn mục lục cuối tệp thì NÉM — hai nửa của zip phải cùng tồn tại', () => {
    // Cắt đúng 22 byte cuối là bỏ end-of-central-directory. Dữ liệu mục vẫn
    // đọc được theo dòng, nên bản không đối chiếu trả về ĐỦ hai tệp và không
    // ném — trong khi `unzip(1)` hay `unzipSync`, vốn đọc mục lục, sẽ từ chối
    // chính tệp đó. Hai công cụ, hai câu trả lời: đúng thứ phải chặn.
    const good = packZip(new Map([['a.txt', enc('AAAA')], ['b.txt', enc('BBBB')]]));
    expect(catchUnsafe(() => unpackZip(good.subarray(0, good.length - 22))).code).toBe('MALFORMED');
  });

  it('kho KHÔNG có mục lục bị từ chối TRƯỚC khi bung một byte nào', () => {
    // Phép đối chiếu số mục ở CUỐI cũng đủ để ném, nên dòng này không nói về
    // "có ném hay không" mà về "ném vào lúc nào": `bytesRead === 0` là lời hứa
    // rằng một kho hỏng không tốn gì cả. Bỏ phép kiểm mục lục ở đầu hàm thì
    // quả bom 128 MiB dưới đây vẫn bị chặn — sau khi đã bung 24 MiB.
    const bomb = streamedBomb('big.bin', 128 * 1024 * 1024);
    const err = catchUnsafe(() => unpackZip(bomb.subarray(0, bomb.length - 22)));
    expect(err.code).toBe('MALFORMED');
    expect(err.bytesRead, 'kho không có mục lục thì không được giải nén gì cả').toBe(0);
  });

  it('byte thừa SAU mục lục bị từ chối — nối đuôi cũng là tệp lai', () => {
    // Ảnh chiếu của luật "phải bắt đầu bằng chữ ký zip". Nếu chỉ quét ngược tìm
    // "PK\x05\x06" mà không kiểm trường độ dài chú thích, thì mọi thứ nối vào
    // đuôi tệp đều được nuốt im lặng: kho vẫn đọc được, số mục vẫn khớp, và
    // phần đuôi — thứ mà công cụ khác có thể diễn giải kiểu khác — không ai
    // nhắc tới. Trường độ dài chú thích phải chạm đúng cuối tệp.
    const good = packZip(new Map([['a.txt', enc('AAAA')]]));
    const withTail = new Uint8Array(good.length + 16);
    withTail.set(good, 0);
    withTail.set(enc('TRAILINGGARBAGE!'), good.length);
    expect(catchUnsafe(() => unpackZip(withTail)).code).toBe('MALFORMED');
  });

  it('mục lục KHAI SỐ MỤC SAI thì NÉM, kể cả khi dữ liệu đọc được', () => {
    // Trường "tổng số mục" nằm ở offset 10 của EOCD. Sửa nó thành 3 trong khi
    // chỉ có 2 local header: đây là dạng "hai nửa của kho nói khác nhau", và
    // phép đối chiếu chỉ có nghĩa nếu nó thực sự so sánh.
    const good = packZip(new Map([['a.txt', enc('AAAA')], ['b.txt', enc('BBBB')]]));
    const tampered = good.slice();
    tampered[tampered.length - 22 + 10] = 3;
    expect(catchUnsafe(() => unpackZip(tampered)).code).toBe('MALFORMED');
    // …và ĐỐI CHỨNG: chưa sửa thì đọc bình thường.
    expect([...unpackZip(good).keys()]).toEqual(['a.txt', 'b.txt']);
  });
});

// ---------------------------------------------------------------------------
// Hai nửa của một zip phải nói CÙNG MỘT chuyện — ở mức TÊN, không chỉ mức SỐ.
//
// `fflate.Unzip` (thứ `unpackZip` dùng) đi theo local header. `unzipSync`,
// `python zipfile`, `java.util.zip`, `JSZip`, `unzip(1)` đi theo mục lục ở cuối
// tệp. Phép đối chiếu SỐ MỤC bịt được bất đồng về số lượng; bất đồng về TÊN thì
// không, và tên chính là phần mang đường thoát.
// ---------------------------------------------------------------------------

describe('mục lục và local header phải khai cùng những cái tên', () => {
  it('local khai "manifest.json", mục lục khai "../../evil.js" → NÉM', () => {
    // Đo bằng bốn trình đọc trên ĐÚNG những byte này (xem báo cáo), trước khi
    // có luật:
    //   unpackZip         : ACCEPTED keys=["manifest.json"]   ← cổng nói ĐƯỢC
    //   fflate.unzipSync  : ["../../evil.js"]
    //   python3 zipfile   : ['../../evil.js']
    //   /usr/bin/unzip -l : ../../evil.js
    // Không trình nào ghi ra ngoài thư mục đích (Info-ZIP cắt "../" rồi cảnh
    // báo; ditto dùng tên local) — nhưng đó là may, không phải luật, và nó
    // KHÔNG phải vấn đề chính. Vấn đề chính: tệp đã qua kiểm định
    // (`manifest.json`) và tệp mọi công cụ khác nhìn thấy (`evil.js`) là HAI tệp
    // khác nhau. Sổ đăng ký lưu byte gói gốc; người tải về mở bằng công cụ của
    // họ và nhận một gói chưa từng đi qua cổng này.
    //
    // Hai tên dài BẰNG NHAU (13 ký tự) nên không một byte nào khác trong kho
    // phải dịch chỗ, và số mục vẫn 1 = 1: phép đối chiếu số mục không chạm tới.
    const good = packZip(new Map([['manifest.json', enc('{"id":"demo"}')]]));
    const forged = renameInCentralDirectory(good, 'manifest.json', '../../evil.js');
    expect(forged).not.toEqual(good); // phép vá thực sự đã đổi byte
    const err = catchUnsafe(() => unpackZip(forged));
    expect(err.code).toBe('MALFORMED');
    expect(err.bytesRead, 'kho hai-nửa-nói-khác-nhau không được bung một byte nào').toBe(0);
  });

  it('bất đồng tên bị chặn kể cả khi CẢ HAI tên đều vô hại', () => {
    // Luật là "hai nửa phải khớp", KHÔNG phải "tên trong mục lục không được
    // thoát ra". Nếu chỉ chạy `escapesPackage` trên tên mục lục thì cặp
    // (a.txt, b.txt) đi lọt — mà nó vẫn là hai gói khác nhau cho hai trình đọc.
    const good = packZip(new Map([['a.txt', enc('AAAA')]]));
    const forged = renameInCentralDirectory(good, 'a.txt', 'b.txt');
    expect(catchUnsafe(() => unpackZip(forged)).code).toBe('MALFORMED');
  });

  it('ĐỐI CHỨNG: kho chưa bị vá — cùng đường đi, cùng helper — đọc bình thường', () => {
    // Không có dòng này thì hai ca trên có thể xanh vì `renameInCentralDirectory`
    // làm hỏng kho, chứ không phải vì phép đối chiếu tên chạy đúng.
    const good = packZip(new Map([['a.txt', enc('AAAA')], ['b.txt', enc('BBBB')]]));
    expect([...unpackZip(renameInCentralDirectory(good, 'a.txt', 'a.txt')).keys()])
      .toEqual(['a.txt', 'b.txt']);
  });

  it('tên KHÔNG PHẢI ASCII vẫn so khớp được — phép giải mã hai bên phải giống nhau', () => {
    // Phép đối chiếu chỉ có nghĩa nếu tên trong mục lục được giải mã ĐÚNG như
    // `fflate` giải mã tên trong local header: UTF-8 khi bit 11 của general
    // purpose flag bật, còn không thì từng byte một. Sai một trong hai thì gói
    // tiếng Việt nào cũng thành MALFORMED — một cổng "an toàn" vì nó từ chối
    // tất cả.
    const files = new Map([['assets/anh nền.png', enc('x')], ['trống.txt', enc('y')]]);
    expect([...unpackZip(packZip(files)).keys()]).toEqual(['assets/anh nền.png', 'trống.txt']);
  });
});

// ---------------------------------------------------------------------------
// Vòng tròn — nội dung phải quay về NGUYÊN VẸN, không chỉ "gần đúng".
// ---------------------------------------------------------------------------

describe('vòng tròn giữ nguyên byte', () => {
  it('nhiều tệp, thư mục lồng, nhị phân, tên tiếng Việt', () => {
    const bin = new Uint8Array(512);
    for (let i = 0; i < bin.length; i++) bin[i] = (i * 37) & 0xff;
    const files = new Map<string, Uint8Array>([
      ['manifest.json', enc('{"id":"demo"}')],
      ['chapters/c1.html', enc('<p>Xin chào — “dấu”</p>')],
      ['assets/anh nền.png', bin],
      ['trống.txt', new Uint8Array(0)],
    ]);
    const back = unpackZip(packZip(files));
    expect([...back.keys()].sort()).toEqual([...files.keys()].sort());
    for (const [name, bytes] of files) expect([...back.get(name)!]).toEqual([...bytes]);
  });

  it('ĐỌC được mục tên "__proto__" — Map miễn nhiễm với cái tên đó', () => {
    // Phía ĐỌC là phía nhận byte của người lạ, và nó không sao: kết quả là một
    // `Map`, còn `Map` coi `__proto__` như mọi khoá khác.
    const back = unpackZip(rawZip([['__proto__', enc('nội dung')]]));
    expect([...back.keys()]).toEqual(['__proto__']);
    expect(back.get('__proto__')).toEqual(enc('nội dung'));
  });

  it('GHI thì TỪ CHỐI tên "__proto__" — thà ném còn hơn ghi ra kho khác', () => {
    // Phía GHI thì không: `fflate` đánh địa chỉ mục bằng khoá object, và
    // `obj['__proto__'] = v` đặt prototype chứ không lưu gì. Cùng họ lỗi với
    // "quyết định theo đuôi tệp" — một cái tên đặc biệt đi một đường riêng mà
    // không ai canh. fflate 0.8.2 tình cờ chết ồn ào ở đó; "tình cờ" không phải
    // là một hợp đồng, nên `packZip` tự chặn.
    const err = catchUnsafe(() => packZip(new Map([['__proto__', enc('x')]])));
    expect(err.code).toBe('MALFORMED');
    expect(err.entry).toBe('__proto__');
    // …và chỉ ĐÚNG cái tên đó, không phải mọi tên chứa nó.
    expect([...unpackZip(packZip(new Map([['chapters/__proto__', enc('x')]]))).keys()])
      .toEqual(['chapters/__proto__']);
  });

  it('nội dung trả về KHÔNG chia sẻ bộ nhớ với zip đầu vào', () => {
    // Mục lưu ở dạng "stored" (nén 0) được fflate chuyển thẳng qua như một
    // subarray của buffer đầu vào. Người gọi sửa buffer đó — hoặc tái dùng nó —
    // thì Map đổi theo. Bản sao là bắt buộc.
    const zip = rawZip([['a.txt', enc('AAAA')]]);
    const back = unpackZip(zip);
    zip.fill(0);
    expect(back.get('a.txt')).toEqual(enc('AAAA'));
  });

  it('mục thư mục (0 byte, tên kết thúc bằng "/") bị bỏ, không thành tệp rỗng', () => {
    const zip = rawZip([
      ['chapters/', new Uint8Array(0)],
      ['chapters/c1.html', enc('<p>a</p>')],
    ]);
    expect([...unpackZip(zip).keys()]).toEqual(['chapters/c1.html']);
  });

  it('mục tên kết thúc bằng "/" nhưng CÓ nội dung thì KHÔNG bị bỏ', () => {
    // Ngược lại của luật trên, và đây là nửa quan trọng: "bỏ theo tên" là một
    // lỗ. Chỉ khi thực sự rỗng nó mới là dấu thư mục.
    const zip = rawZip([['la/', enc('không rỗng')]]);
    expect([...unpackZip(zip).keys()]).toEqual(['la/']);
  });
});

// ---------------------------------------------------------------------------
// packZip: đầu ra phải TÁI LẬP ĐƯỢC, vì sổ đăng ký sẽ băm nó.
// ---------------------------------------------------------------------------

describe('packZip sinh byte tái lập được', () => {
  it('đóng gói hai lần cho cùng byte', () => {
    // fflate mặc định ghi `Date.now()` vào mtime của từng mục. Hai lần đóng gói
    // cùng nội dung sẽ ra hai tệp khác nhau, và mọi thứ băm-theo-nội-dung ở
    // tầng trên (sổ đăng ký, cache trình duyệt) mất tác dụng.
    const files = new Map([['a.txt', enc('x')], ['b.txt', enc('y')]]);
    expect(packZip(files)).toEqual(packZip(files));
  });

  it('dấu thời gian là HẰNG SỐ đã ghim, không phải đồng hồ', () => {
    // Ca "đóng gói hai lần" ở trên KHÔNG bắt được `Date.now()`: hai lần chạy
    // cách nhau vài mili giây rơi vào cùng một ô 2 giây của DOS timestamp, nên
    // nó xanh cả với bản dựng rơm. Ghim thẳng 4 byte đó.
    //
    // 1985-01-01 00:00:00 giờ ĐỊA PHƯƠNG: (5<<25)|(1<<21)|(1<<16) = 0x0A210000,
    // little-endian ở offset 10 của local header. Giờ địa phương chứ không phải
    // UTC là có chủ ý: zip lưu giờ địa phương và fflate đọc bằng getFullYear(),
    // nên một MỐC THỜI GIAN cố định vẫn ra byte khác nhau ở múi giờ khác nhau —
    // một MẶT ĐỒNG HỒ cố định thì không.
    const z = packZip(new Map([['a.txt', enc('x')]]));
    expect([z[10], z[11], z[12], z[13]]).toEqual([0x00, 0x00, 0x21, 0x0a]);
  });

  it('thứ tự chèn vào Map KHÔNG đổi đầu ra', () => {
    const a = new Map([['a.txt', enc('x')], ['b.txt', enc('y')]]);
    const b = new Map([['b.txt', enc('y')], ['a.txt', enc('x')]]);
    expect(packZip(a)).toEqual(packZip(b));
  });

  it('gói rỗng vẫn là một zip đọc lại được', () => {
    expect([...unpackZip(packZip(new Map()))]).toEqual([]);
  });

  it('packZip KHÔNG kiểm định — chốt nằm ở phía ĐỌC, và đó là chủ ý', () => {
    // Ghi rõ để người sau không "sửa" nhầm: `packZip` phải đóng gói được cả
    // đường dẫn độc, nếu không thì không có cách nào viết bài kiểm tra ở trên.
    // Byte không tin được đến từ phía đọc, nên chốt ở phía đọc. CLI đóng gói
    // (task 3) tự gọi `validatePackage` trước khi gọi `packZip`.
    expect(() => packZip(new Map([['../x', enc('a')]]))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Gói THẬT. Sáu phép đo sai trong dự án này đã bị bác bỏ ở đúng bước này.
// ---------------------------------------------------------------------------

describe('gói thật: courses/***REMOVED***', () => {
  /** vitest chạy với cwd = `packages/course-format` (xem Makefile: test-format). */
  const ROOT = '../../courses/***REMOVED***';

  const readReal = (): Map<string, Uint8Array> => {
    const files = new Map<string, Uint8Array>();
    for (const name of readdirSync(ROOT).sort()) {
      if (name === 'chapters') continue;
      files.set(name, readFileSync(`${ROOT}/${name}`));
    }
    for (const name of readdirSync(`${ROOT}/chapters`).sort()) {
      files.set(`chapters/${name}`, readFileSync(`${ROOT}/chapters/${name}`));
    }
    return files;
  };

  it('46 tệp, 1.263.009 byte — con số, để một gói đọc hụt không lặng lẽ qua', () => {
    const files = readReal();
    expect(files.size).toBe(46);
    let total = 0;
    for (const b of files.values()) total += b.byteLength;
    expect(total).toBe(1_263_009);
  });

  it('pack → unpack khớp TỪNG BYTE cho cả 46 tệp', () => {
    const files = readReal();
    const zip = packZip(files);
    expect(zip.byteLength).toBeLessThan(files.size === 0 ? 1 : 1_263_009); // thật sự có nén
    const back = unpackZip(zip);
    expect([...back.keys()]).toEqual([...files.keys()].sort());
    for (const [name, bytes] of files) {
      const got = back.get(name);
      expect(got, name).toBeDefined();
      expect(got!.byteLength, name).toBe(bytes.byteLength);
      expect(got!.every((v, i) => v === bytes[i]), `${name} khác byte`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// `src/node-test-env.d.ts` khai `node:fs` cho khối test ở trên, và một khai báo
// module môi trường thì CẢ dự án nhìn thấy. Bịt lại từ bên ngoài.
// ---------------------------------------------------------------------------

it('mã ĐƯỢC SHIP không import "node:" — d.ts của test đã mở cửa đó', () => {
  const decoder = new TextDecoder('utf-8');
  for (const f of ['src/zip.ts', 'src/validate.ts', 'src/types.ts', 'src/index.ts']) {
    expect(decoder.decode(readFileSync(f)).includes("'node:"), f).toBe(false);
  }
});

// ---------------------------------------------------------------------------
// Trợ giúp.
// ---------------------------------------------------------------------------

/** Bắt `UnsafeArchiveError` và bắt cả việc KHÔNG có gì được ném. */
function catchUnsafe(fn: () => unknown): UnsafeArchiveError {
  try {
    fn();
  } catch (e) {
    if (e instanceof UnsafeArchiveError) return e;
    throw e;
  }
  throw new Error('không có gì được ném');
}

/**
 * Một zip dựng bằng `fflate.Zip` trực tiếp, để làm được những kho mà `packZip`
 * cố ý không làm được: hai mục trùng tên, mục lưu nguyên (stored), mục 0 byte
 * mang tên thư mục.
 */
function rawZip(entries: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const z = new Zip((err, data) => {
    if (err) throw err;
    parts.push(data);
  });
  for (const [name, bytes] of entries) {
    const f = new ZipPassThrough(name);
    f.mtime = Date.UTC(1985, 0, 1);
    z.add(f);
    f.push(bytes, true);
  }
  z.end();
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) out.set(p, at), (at += p.length);
  return out;
}

/**
 * Đổi tên một mục TRONG MỤC LỤC mà không chạm vào local header của nó — tức là
 * dựng ra một kho mà hai nửa nói khác nhau.
 *
 * Bắt buộc cùng độ dài tên: giữ nguyên mọi offset trong kho, nên phép vá không
 * thể làm kho hỏng theo cách nào khác, và số mục vẫn khớp. Ném nếu không đúng
 * một bản ghi được sửa — một helper vá hụt sẽ làm ca test xanh vì lý do sai.
 */
function renameInCentralDirectory(zip: Uint8Array, from: string, to: string): Uint8Array {
  const f = enc(from);
  const t = enc(to);
  if (f.length !== t.length) throw new Error('renameInCentralDirectory: hai tên phải cùng số byte');
  const out = zip.slice();
  let patched = 0;
  for (let i = 0; i + 46 <= out.length; i++) {
    // "PK\x01\x02" — một bản ghi trong mục lục.
    if (out[i] !== 0x50 || out[i + 1] !== 0x4b || out[i + 2] !== 0x01 || out[i + 3] !== 0x02) continue;
    if (((out[i + 28] as number) | ((out[i + 29] as number) << 8)) !== f.length) continue;
    if (!f.every((b, k) => out[i + 46 + k] === b)) continue;
    out.set(t, i + 46);
    patched++;
  }
  if (patched !== 1) throw new Error(`renameInCentralDirectory: vá ${patched} bản ghi, cần đúng 1`);
  return out;
}

/** Vị trí mọi chữ ký local file header ("PK\x03\x04") trong kho. */
function localHeaderOffsets(zip: Uint8Array): number[] {
  const at: number[] = [];
  for (let i = 0; i + 4 <= zip.length; i++) {
    if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x03 && zip[i + 3] === 0x04) at.push(i);
  }
  return at;
}

/**
 * Một kho có ĐÚNG một mục bung ra `bytes` byte, nén theo dòng nên chính bài
 * test không bao giờ giữ `bytes` byte trong bộ nhớ — và, quan trọng hơn, mục
 * dùng data descriptor nên local header KHÔNG mang kích thước giải nén.
 */
function streamedBomb(name: string, bytes: number): Uint8Array {
  const parts: Uint8Array[] = [];
  const z = new Zip((err, data) => {
    if (err) throw err;
    parts.push(data);
  });
  const f = new ZipDeflate(name, { level: 1 });
  f.mtime = new Date(1985, 0, 1).getTime();
  z.add(f);
  const CHUNK = 1 << 20;
  const zeros = new Uint8Array(CHUNK);
  let left = bytes;
  while (left > CHUNK) {
    f.push(zeros, false);
    left -= CHUNK;
  }
  f.push(zeros.subarray(0, left), true);
  z.end();
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) out.set(p, at), (at += p.length);
  return out;
}

/**
 * Ghi đè trường "uncompressed size" (4 byte, offset 22) của MỌI local header
 * trong kho. Local header là thứ `fflate.Unzip` đọc khi giải nén theo dòng.
 */
function lieAboutUncompressedSize(zip: Uint8Array, claim: number): Uint8Array {
  const out = zip.slice();
  for (let i = 0; i + 30 <= out.length; i++) {
    if (out[i] === 0x50 && out[i + 1] === 0x4b && out[i + 2] === 0x03 && out[i + 3] === 0x04) {
      out[i + 22] = claim & 0xff;
      out[i + 23] = (claim >>> 8) & 0xff;
      out[i + 24] = (claim >>> 16) & 0xff;
      out[i + 25] = (claim >>> 24) & 0xff;
    }
  }
  return out;
}
