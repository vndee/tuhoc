# Across the Noise — bản thảo biên tập Việt–Anh

Bản copy để duyệt cùng [thiết kế](2026-09-05-across-the-noise-design.md) và [12 lab](2026-09-05-across-the-noise-labs.md). Không phải nội dung đã phát hành. Các ID nguồn trỏ tới bảng nguồn và phạm vi dẫn chứng trong thiết kế.

## Cover

**Title VI:** Một lời nói đi qua đại dương

**Title EN:** Across the Noise

**Deck VI:** Có một người ở bên kia đại dương đang chờ câu trả lời của bạn. Từ dấu hiệu và dây cáp đến nén dữ liệu và sửa lỗi, điều gì giúp lời nói đến nơi — và điều gì vẫn nằm ngoài đường truyền?

**Deck EN:** Someone across the ocean is waiting for your reply. From symbols and cables to compression and error correction, what helps a message arrive—and what remains beyond the reach of its channel?

**Opening VI:** Bạn có thể mang một câu của mình qua các thí nghiệm trong số này, hoặc dùng câu mẫu. Không cần tài khoản. Thông điệp chỉ được xử lý trong trình duyệt; tải lại trang hoặc rời đặc san sẽ đặt lại lượt thử.

**Opening EN:** Carry your own message through these experiments, or use an example. No account is needed. The message is processed only in your browser; reloading or leaving the edition resets the experiment.

**Editorial notice VI:** Những người gửi và người nhận không tên là nhân vật hư cấu. Tư liệu lịch sử có dẫn nguồn riêng. Các lab dùng mô hình giản lược; chúng không tái tạo một bức điện lịch sử đi qua mọi công nghệ về sau.

**Editorial notice EN:** The unnamed senders and receivers are fictional. Historical material is sourced separately. The labs use simplified models; they do not recreate a historical telegram passing through technologies developed later.

**Cover alt VI:** Một bàn viết cạnh cửa sổ nhìn ra cảng, với con tàu nhỏ trong sương và tờ giấy chưa có chữ.

**Cover alt EN:** A writing desk beside a window overlooking a harbor, with a small ship in the mist and an unmarked sheet of paper.

**Cover caption VI:** Minh hoạ: trước khi có đường truyền, có một người muốn nói và một người đang chờ.

**Cover caption EN:** Illustration: before there is a channel, there is someone who wants to speak and someone waiting.

## Hồi 1 — Trước khi lời nói có thể lên đường / Before Words Can Travel

**Question VI:** Muốn gửi một điều đi xa, trước hết ta phải biến nó thành thứ gì?

**Question EN:** Before sending something far away, what must we turn it into?

**Consequence VI:** Người gửi không làm việc một mình. Bảng mã, khoảng nghỉ và người giải mã cùng tham gia tạo ra một thông điệp có thể được nhận lại.

**Consequence EN:** The sender does not work alone. A codebook, pauses and a decoder all help make a message recoverable.

## Cảnh 01 — Có người đang chờ / Someone Is Waiting

**Period VI:** Một tình huống hư cấu để bắt đầu

**Period EN:** A fictional starting point

**Sources:** `morse-archive`, `unicode-segmentation`

### Human VI

Hãy hình dung bạn vừa đến một bến cảng xa. Bạn muốn báo tin cho một người đã chờ suốt ngày, nhưng câu đầu tiên viết ra dài hơn chỗ trống trên tờ giấy. Bạn bỏ một lời giải thích, rồi một chi tiết tưởng như không cần. Câu còn lại gọn hơn. Nó có còn khiến người nhận yên lòng theo cách bạn muốn không? Trong tình huống hư cấu này, điều quan trọng không phải viết được câu ngắn nhất. Đó là nhận ra mỗi lần rút lời cũng là một lựa chọn về điều người kia sẽ biết. Người nhận không có mặt để hỏi lại ngay. Một từ bạn thấy dư có thể là thứ họ đang chờ. Trước khi chạm tới dây dẫn hay phép tính, việc truyền tin đã có hai con người với hai phần hiểu biết không hoàn toàn giống nhau.

### Human EN

Imagine that you have just reached a distant harbor. Someone has been waiting all day for news, but your first sentence is longer than the space on the paper. You remove an explanation, then a detail that seems unnecessary. The remaining message is shorter. Will it reassure its reader in the way you intended? In this fictional situation, the goal is not to write the shortest possible sentence. It is to notice that every cut changes what another person can know. The receiver is not beside you to ask a question. A word that feels redundant to you might be exactly what they are waiting for. Before wires or calculations enter the story, communication already involves two people whose knowledge of the situation is not quite the same.

### Technical VI

Lab đếm ký tự người dùng nhìn thấy và byte UTF-8 riêng biệt. Hai con số trả lời hai câu hỏi khác nhau: câu dài bao nhiêu khi đọc và cần bao nhiêu byte theo cách mã hoá đang dùng. Rút gọn câu bằng cách bỏ lời là biên tập, có thể thay đổi ý; chưa phải nén không mất mát. Chúng ta giữ cả bản gốc và bản rút lời để bạn tự đối chiếu, không dùng thuật toán chấm mức độ bảo toàn ý nghĩa.

### Technical EN

The lab counts visible character clusters separately from UTF-8 bytes. These numbers answer different questions: how long the message appears to a reader, and how many bytes its chosen encoding requires. Removing words is editing and may change meaning; it is not yet lossless compression. Both the original and the shortened draft remain available for comparison. The program checks the stated budget, but it does not assign a score to how faithfully another person would understand your intention.

**Question VI:** Từ nào bạn sẵn lòng bỏ đi, và từ nào bạn nghĩ người nhận cần nhất?

**Question EN:** Which word would you remove, and which one might the receiver need most?

**Alt VI:** Hai căn phòng tách nhau: một người cúi viết, một người ngồi cạnh bàn còn trống.

**Alt EN:** Two separate rooms: someone bends over a message while another person sits beside an empty table.

**Caption VI:** Minh hoạ hư cấu: hai phía của một lời nhắn chưa lên đường.

**Caption EN:** Illustration of a fictional situation: the two sides of a message not yet sent.

## Cảnh 02 — Ta phải đồng ý về những dấu hiệu / Agreeing on Signs

**Period VI:** Tư liệu 1844 và một bàn mã giả lập

**Period EN:** An 1844 artifact and an experimental codebook

**Sources:** `morse-tape`, `morse-archive`, `huffman-1952`

### Human VI

Một dải giấy có dấu không tự đọc thành lời. Có người tạo dấu, người giữ quy ước và người đối chiếu chúng với điều cần hiểu. Tư liệu điện báo năm 1844 nhắc đến Morse ở phía gửi, Alfred Vail ở phía nhận và Annie Ellsworth trong việc chọn câu được truyền. Chi tiết ấy mở rộng khung hình: thành công không chỉ thuộc về một thiết bị hay một tên tuổi. Trở lại bàn thử của chúng ta, hãy tưởng tượng hai người cùng nhận một dải dấu nhưng cầm hai cách chia đoạn khác nhau. Cả hai có thể đọc rất cẩn thận mà vẫn cho ra hai câu. Vấn đề không nằm ở việc ai tập trung hơn. Họ chưa có một quy ước đủ rõ để cùng biết mỗi dấu bắt đầu, kết thúc và đại diện cho điều gì.

### Human EN

A marked strip of paper does not read itself. Someone makes the marks, someone maintains the convention, and someone relates them to what must be understood. The record of the 1844 demonstration identifies Morse at the sending end, Alfred Vail at the receiving end, and Annie Ellsworth in the choice of the message. That detail widens the picture beyond a single device or inventor. At our experimental table, imagine two careful readers holding the same strip but dividing it differently. They may both follow their instructions faithfully and still arrive at different readings. The problem is not necessarily carelessness. Their shared convention does not yet tell them clearly enough where a sign begins, where it ends, and what it represents. The codebook is part of the working communication system, not an accessory to it.

### Technical VI

Khi các mã ký hiệu được nối lại, người nhận cần tìm được ranh giới giữa chúng. Lab cho phép bạn tạo bảng mã có nhiều cách phân đoạn, rồi hiện các kết quả giải mã hợp lệ. Một bảng mã prefix-free tránh việc mã của ký hiệu này là phần đầu của mã khác. Đây là một cách thiết kế hữu ích, không phải lời khẳng định rằng mọi bảng có quan hệ prefix đều khiến mọi thông điệp nhập nhằng. Ta kiểm tra chuỗi thật đã gửi.

### Technical EN

When symbol codes are concatenated, a receiver must recover their boundaries. This lab lets you build a codebook with competing segmentations and displays the valid readings of the actual transmitted sequence. A prefix-free code prevents one complete codeword from being the beginning of another. That is a useful design property, not a claim that every codebook containing a prefix relationship makes every possible message ambiguous. We examine the sequence you sent instead of confusing a warning about the codebook with proof about each message.

**Question VI:** Phần nào của một quy ước thường bị xem là hiển nhiên cho tới khi hai người hiểu khác nhau?

**Question EN:** Which part of a convention feels obvious until two people interpret it differently?

**Alt VI:** Hai người đối chiếu những thẻ ký hiệu và một dải giấy trên cùng mặt bàn.

**Alt EN:** Two people compare symbol cards and a paper strip on a shared table.

**Caption VI:** Minh hoạ: dấu hiệu cần cả người vận hành lẫn quy ước để trở thành lời.

**Caption EN:** Illustration: marks need both operators and conventions to become a message.

## Cảnh 03 — Khoảng lặng cũng mang thông tin / Silence Carries Information

**Period VI:** Quy ước Morse quốc tế, không phải bản phục dựng 1844

**Period EN:** International Morse conventions, not an 1844 reconstruction

**Sources:** `itu-morse`, `morse-tape`

### Human VI

Hãy nhìn bàn tay người vận hành trong cảnh minh hoạ. Lúc ngón tay dừng lại, công việc chưa dừng. Khoảng nghỉ là phần họ phải tạo ra và người bên kia phải nhận biết. Nếu chỉ giữ những tiếng gõ mà bỏ hết khoảng cách, ta có thể bảo toàn các dấu nhưng làm mất cách chia lời. Trong bàn thử, bạn sẽ không cần nghe giỏi hoặc thuộc bảng mã. Những đoạn im lặng được đặt lên cùng một thước thời gian với dấu chấm và gạch. Bạn có thể chỉ vào chúng, kéo dài chúng và nhìn kết quả đổi khác. Cảnh này dành sự chú ý cho một loại lao động dễ biến mất trong câu chuyện phát minh: giữ đúng nhịp để người khác có thể tiếp tục công việc của mình mà không phải đoán mọi ranh giới.

### Human EN

Look at the operator’s hand in this illustration. When the finger stops moving, the work has not stopped. The pause is something the sender must produce and the receiver must recognize. If we preserve every mark but remove the intervals, we can keep the visible signs while losing the way they divide into words. At this experimental table, you do not need trained hearing or a memorized codebook. Silence is placed on the same timeline as dots and dashes. You can point to it, lengthen it and watch the reading change. The scene draws attention to work that can disappear from invention stories: maintaining a rhythm clear enough for another person to continue the task without having to guess at every boundary. An absence of sound is not necessarily an absence of structure.

### Technical VI

Bài thử dùng quy ước Morse quốc tế hiện đại: dấu gạch dài ba đơn vị, với các khoảng cách chuẩn giữa thành phần, chữ và từ. Bộ giải mã của lab dùng các ngưỡng được công khai để biến khoảng nghỉ thành ranh giới. Đây là mô hình dạy học, không bao quát toàn bộ thao tác vô tuyến. Mẫu Latin được chọn riêng; câu tiếng Việt của bạn không bị bỏ dấu hoặc âm thầm chuyển thành một thông điệp khác để vừa bảng mã.

### Technical EN

The experiment uses modern International Morse timing, with a dash lasting three units and defined gaps within letters, between letters and between words. Its teaching decoder uses explicitly stated thresholds to turn pauses into boundaries. This is not a complete model of radio operating practice. The Latin examples are separate controlled samples. Your Vietnamese message is not stripped of its accents or silently rewritten to fit a codebook that does not represent all its characters. The visual timeline contains everything required to explore the idea without audio.

**Question VI:** Trong những cuộc trao đổi thường ngày, điều gì đóng vai trò như khoảng nghỉ giữa các dấu?

**Question EN:** In everyday exchanges, what plays the role of a pause between marks?

**Alt VI:** Cận cảnh bàn tay bên cần điện báo và những mảnh giấy đặt cách nhau trên bàn.

**Alt EN:** A close view of a hand beside a telegraph key and paper fragments spaced across a table.

**Caption VI:** Minh hoạ: khoảng nghỉ cũng là một phần của công việc truyền tin.

**Caption EN:** Illustration: pauses are also part of the work of communication.

## Hồi 2 — Đại dương không phải khoảng trống / The Ocean Is Not Empty

**Question VI:** Điều gì xảy ra khi những dấu hiệu phải đi qua vật chất?

**Question EN:** What happens when those signs must travel through matter?

**Consequence VI:** Một đường truyền cần công xưởng, con tàu, người vận hành và nguồn lực. Khi ta thu gọn nó thành một đường trong sơ đồ, những điều ấy không biến mất.

**Consequence EN:** A channel needs workshops, ships, operators and resources. Reducing it to a line in a diagram does not make those things disappear.

## Cảnh 04 — Dưới mỗi thông điệp là một công trình / Infrastructure Beneath Every Message

**Period VI:** Cáp Đại Tây Dương, thế kỷ XIX

**Period EN:** Nineteenth-century Atlantic cables

**Sources:** `cable-history`, `cable-object`, `cable-workers`

### Human VI

Trước khi có người chờ bên máy nhận, có người phải làm việc bên cuộn cáp. Trong khung hình này, boong tàu không phải phông nền cho một nhân vật chính. Những người giữ vật liệu, theo dõi máy và phối hợp thao tác cùng làm nên công trình. Các nỗ lực nối cáp Đại Tây Dương năm 1858 và tuyến thành công năm 1866 cho câu chuyện một nhịp khác với bấm nút rồi nhận kết quả. Vật liệu có thể hỏng, công việc phải làm lại, nguồn lực không tự xuất hiện. Ở bàn thử, bạn sẽ chọn giữa ba tuyến hư cấu. Một tuyến ngắn hơn có thể đi qua nhiều đoạn khó hơn. Những con số không tái hiện chi phí lịch sử; chúng giúp đặt một câu hỏi trước mỗi lựa chọn: ai và thứ gì phải gánh phần công việc mà một đường kẻ trên bản đồ đã che đi?

### Human EN

Before someone could wait beside a receiver, someone had to work beside a cable reel. On this illustrated deck, the ship is not scenery for a lone protagonist. People handling material, watching equipment and coordinating their movements are part of the achievement. The Atlantic cable efforts of 1858 and the successful connection of 1866 give the story a different rhythm from pressing a button and getting a result. Material can fail, work may need repeating, and resources do not appear by themselves. At your experimental table, three fictional routes offer different trade-offs. A shorter path can cross more difficult terrain. These numbers do not reconstruct historical costs. They make a decision visible and ask whose work, and which resources, can disappear when a complicated undertaking becomes a neat line on a map.

### Technical VI

Bản đồ của lab là dữ liệu giả lập với chiều dài, số đoạn khó và số đoạn sâu đã công bố. Một hàm chi phí đơn giản cộng các thành phần để người đọc kiểm tra được từng bước. Không có đơn vị kilomet hoặc tiền thật, cũng không có xác suất thất bại được gán cho biển lịch sử. Mục tiêu là thấy kết quả phụ thuộc vào điều ta đưa vào mô hình; một phương án tốt theo hàm này chưa chắc tốt theo những tiêu chí chưa được tính.

### Technical EN

The lab’s map is a fictional dataset with declared route lengths, difficult segments and deep segments. A simple cost function adds those components so that you can inspect the calculation step by step. It does not use real kilometers or currency, and it does not assign invented historical failure probabilities to the ocean. The point is to see how a decision depends on what a model includes. A route that looks favorable under this function need not be favorable under criteria the function leaves out.

**Question VI:** Nếu thêm điều kiện lao động hoặc tác động môi trường, bạn sẽ muốn biết gì trước khi chọn tuyến?

**Question EN:** If working conditions or environmental effects mattered to the decision, what else would you need to know?

**Alt VI:** Nhiều công nhân phối hợp quanh cuộn cáp trên boong tàu, phía ngoài là một vùng biển rộng.

**Alt EN:** Several workers coordinate around a cable reel on a ship’s deck, with open sea beyond them.

**Caption VI:** Minh hoạ: đường truyền là một công trình vật chất và lao động tập thể.

**Caption EN:** Illustration: a channel is a material undertaking built through collective work.

## Cảnh 05 — Tín hiệu mất hình dạng / When Signals Lose Their Shape

**Period VI:** Một bàn thử kênh truyền giản lược

**Period EN:** A simplified channel experiment

**Sources:** `mit-isi`, `cable-object`

### Human VI

Hãy hình dung một người đứng trước thiết bị nhận, nhìn những thay đổi nhỏ mà người khác có thể bỏ qua. Người gửi tin rằng mình đã tạo ra các dấu rất rõ. Người nhận chỉ có thể làm việc với điều thực sự đến được chỗ mình. Giữa hai phía là vật chất, không phải một khoảng trống trung lập. Trong cảnh minh hoạ, mắt người vận hành và mảnh cáp cắt lớp được đặt gần nhau để nhắc về mối liên hệ ấy. Ở bàn thử, bạn sẽ gửi cùng một mẫu nhanh hơn mà không thay kênh. Có lúc điều khó đọc không đến từ một dấu bị ai đó xoá. Nó đến từ việc dấu trước vẫn còn ảnh hưởng khi dấu sau đã tới. Muốn tăng tốc, người thiết kế phải hiểu thứ đang mang tín hiệu, không chỉ thúc người vận hành làm nhanh hơn.

### Human EN

Imagine a receiver watching small changes that another observer might overlook. The sender believes the marks were made clearly. The receiver can work only with what actually arrives. Between those positions lies matter, not a neutral empty space. In the illustration, an operator’s attention and a cut section of cable share the frame to make that relationship visible. At the experimental table, you will send the same pattern faster without changing the channel. A difficult reading does not always mean that somebody erased a mark. It can arise because an earlier mark is still affecting the signal when the next one arrives. Increasing speed therefore requires understanding the thing carrying the signal, not simply asking an operator to work more quickly. The equipment and the pace of work have to be considered together.

### Technical VI

Lab biến bit thành các mức tín hiệu rồi cho chúng đi qua một bộ lọc đơn giản có trí nhớ. Bạn thay thời gian giữ mỗi mức và vị trí lấy mẫu để quan sát quyết định của bộ nhận. Thí nghiệm này không thêm nhiễu ngẫu nhiên; nó tách riêng ảnh hưởng của kênh lên hình dạng xung. Các đơn vị thời gian là quy ước mô phỏng. Ta không dùng đồ thị này để tính hiệu suất một tuyến cáp lịch sử hoặc khẳng định mọi chuỗi bit đều hỏng ở cùng một tốc độ.

### Technical EN

The lab represents bits as signal levels and passes them through a simple filter with memory. You change how long each level is held and when the receiver samples it. No random noise is added in this experiment: it isolates the channel’s effect on pulse shape. Time is measured in simulation units. This graph is not used to calculate the performance of a historical cable, nor does it imply that every bit pattern fails at one universal speed. The displayed decisions follow the actual chosen pattern and model parameters.

**Question VI:** Khi một hệ thống không theo kịp, liệu vấn đề nằm ở tốc độ con người hay ở cấu trúc công việc?

**Question EN:** When a system cannot keep up, is the problem human speed or the structure of the work?

**Alt VI:** Người vận hành quan sát máy đo ở trạm bờ, cạnh một đoạn cáp được cắt để thấy các lớp vật liệu.

**Alt EN:** An operator watches an instrument at a shore station beside a cable section showing its material layers.

**Caption VI:** Minh hoạ: người nhận làm việc với tín hiệu đã đi qua vật chất.

**Caption EN:** Illustration: the receiver works with a signal that has passed through matter.

## Cảnh 06 — Khi thế giới chen vào / When Noise Interferes

**Period VI:** Từ câu chữ sang một thí nghiệm lật bit

**Period EN:** From written words to a bit-flip experiment

**Sources:** `shannon-1948`, `ibm-repetition`

### Human VI

Hai bản ghi được đặt cạnh nhau trên bàn. Một bản là điều người gửi đã giao cho hệ thống; bản kia là điều phía nhận lấy ra được. Trong tình huống này, người kiểm tra chưa cần biết câu ấy mang tin vui hay tin buồn. Họ cần xác định dữ liệu có đổi không và đổi ở đâu. Công việc có vẻ nhỏ: đối chiếu, đánh dấu, thử lại. Nhưng nếu bỏ qua nó, một dòng chữ nhìn vẫn có vẻ hợp lý có thể được chuyển tiếp như thể nguyên vẹn. Bạn sẽ làm công việc ấy với chính câu đã chọn. Có lần thí nghiệm không tạo lỗi nào; có lần một thay đổi khiến một phần văn bản không còn đọc được. Sự khác nhau ấy không chứng minh kênh đã trở nên tốt hoặc xấu vĩnh viễn. Nó là kết quả của một lần thử trong điều kiện đã đặt.

### Human EN

Two records sit side by side on the table. One contains what the sender handed to the system; the other contains what the receiver obtained. In this situation, the person checking them does not yet need to know whether the sentence carries good news or bad. They need to know whether the data changed, and where. The work can look modest: compare, mark and try again. Without it, a line that still appears plausible might be passed onward as if it were intact. You will do that work with your own chosen message. Some runs produce no errors. In others, a small change makes part of the text unreadable. Neither outcome proves that the channel has become permanently good or bad. It describes one experiment performed under the conditions you selected.

### Technical VI

Thí nghiệm dùng kênh nhị phân đối xứng: mỗi bit có cùng xác suất bị đảo, độc lập với các bit khác. Xác suất cấu hình không buộc tỷ lệ lỗi quan sát phải bằng nó trong một thông điệp ngắn. Seed giúp giữ lại cùng mẫu ngẫu nhiên để thử lại. Chúng ta đối chiếu byte gốc và byte nhận, rồi giải mã UTF-8 nghiêm ngặt. Nếu byte không tạo thành văn bản hợp lệ, giao diện nói rõ điều đó thay vì thay ký tự và giả vờ câu đã tới đúng.

### Technical EN

This experiment uses a binary symmetric channel: each bit has the same probability of being flipped, independently of the others. The configured probability does not force the observed error fraction to match it in a short message. A seed makes the random sample reproducible. We compare original and received bytes, then attempt strict UTF-8 decoding. If the received bytes do not form valid text, the interface says so instead of substituting characters and pretending the message arrived correctly. This model does not include every kind of physical interference.

**Question VI:** Bạn sẽ cần bao nhiêu lần thử, và điều kiện nào, trước khi tin một kênh là đáng tin cậy?

**Question EN:** How many trials, under which conditions, would you need before trusting a channel?

**Alt VI:** Hai bản ghi và dụng cụ kiểm tra trên bàn, với các vị trí khác nhau được người vận hành đánh dấu.

**Alt EN:** Two records and checking instruments lie on a desk, with differing positions marked by an operator.

**Caption VI:** Minh hoạ: đối chiếu dữ liệu là một phần của việc làm cho thông điệp đáng tin.

**Caption EN:** Illustration: comparing records is part of making a message trustworthy.

## Hồi 3 — Bớt đi, rồi thêm trở lại / Take Away, Then Add Back

**Question VI:** Vì sao có lúc ta bỏ bit đi, có lúc lại phải thêm vào?

**Question EN:** Why do we sometimes remove bits, then deliberately add them back?

**Consequence VI:** Biểu diễn gọn và chống lỗi là hai nhiệm vụ khác nhau. Việc thêm hay bớt chỉ có nghĩa khi biết ta đang bảo toàn điều gì và sử dụng nguồn lực nào.

**Consequence EN:** Compact representation and error protection are different tasks. Adding or removing bits makes sense only when we know what is being preserved and which resources are being used.

## Cảnh 07 — Không phải tin nào cũng bất ngờ như nhau / Not Every Message Is Equally Surprising

**Period VI:** Một nguồn ký hiệu và câu hỏi về độ bất định

**Period EN:** A source of symbols and a question about uncertainty

**Sources:** `shannon-1948`, `mit-capacity`

### Human VI

Hãy hình dung một người ghi chép bắt đầu nhận ra nhịp lặp trong những ký hiệu đi qua bàn mình. Họ không biết câu tiếp theo nói chuyện gì, nhưng có những dấu xuất hiện nhiều hơn những dấu khác. Kinh nghiệm ấy khiến một câu hỏi mới trở nên tự nhiên: nếu các khả năng không ngang nhau, liệu ta có nên dành cho chúng những cách biểu diễn dài như nhau? Bàn thử cố tình thu nhỏ thế giới thành bốn ký hiệu để câu hỏi hiện ra rõ. Bạn có thể làm một ký hiệu gần như chắc chắn xuất hiện, rồi trả nguồn về trạng thái khó đoán hơn. Điều đang thay đổi là cấu trúc xác suất mà bạn đã đặt, không phải phẩm chất hay giá trị của một lời nhắn. Một câu rất quen vẫn có thể là điều quan trọng nhất với người đang đợi nó.

### Human EN

Imagine someone keeping records who begins to notice recurring patterns in the symbols crossing their desk. They do not know what the next sentence will mean, but some marks appear more often than others. That experience makes a new question natural: if the possibilities are unequal, should we give them equally long representations? The experimental table deliberately reduces the world to four symbols so the question becomes visible. You can make one outcome almost certain, then return the source to a harder-to-predict state. What changes is the probability structure you selected, not the worth or importance of a message. A familiar sentence can still be the most important thing a waiting person hopes to receive. The numerical model is useful precisely because its question is narrower than every question we might ask about words.

### Technical VI

Entropy trong lab mô tả một nguồn rút ký hiệu độc lập theo các xác suất bạn chọn. Đơn vị là bit trên ký hiệu của nguồn, không phải điểm thông minh hoặc mức ý nghĩa của câu. Khi mọi khả năng ngang nhau, việc đoán khó hơn trường hợp một kết quả đã chắc chắn. Bốn trọng số được chuẩn hoá thành phân phối; nếu tất cả bằng không, mô hình chưa có nguồn hợp lệ để tính. Ta không dùng vài tần suất trong một câu ngắn để tuyên bố đã đo được ngôn ngữ tự nhiên.

### Technical EN

Entropy in this lab describes a source that independently draws symbols using probabilities you choose. The unit is bits per source symbol, not intelligence points or a measure of a sentence’s meaning. Equally likely possibilities are less predictable than a certain outcome. The four weights are normalized into a distribution; if they are all zero, there is no valid source to evaluate. We do not use a handful of frequencies from a short sentence to claim that the full structure of natural language has been measured.

**Question VI:** Có điều gì bạn đã biết chắc nhưng vẫn rất cần nghe một người khác nói ra?

**Question EN:** Is there something you already know but still need to hear another person say?

**Alt VI:** Những thẻ ký hiệu được người ghi chép đếm và xếp thành các nhóm lớn nhỏ khác nhau.

**Alt EN:** A record keeper counts symbol cards and sorts them into groups of different sizes.

**Caption VI:** Minh hoạ: tần suất của dấu hiệu không đo tầm quan trọng của lời nói.

**Caption EN:** Illustration: the frequency of a symbol does not measure the importance of a message.

## Cảnh 08 — Gửi ít hơn mà không bỏ chữ nào / Fewer Bits, Nothing Lost

**Period VI:** Mã Huffman và một định dạng gói phục vụ học tập

**Period EN:** Huffman coding and a teaching packet format

**Sources:** `huffman-1952`, `unicode-normalization`

### Human VI

Lần này bạn không được bỏ từ nào. Câu người gửi đã chọn phải quay lại đủ từng byte, kể cả những dấu tiếng Việt dễ bị xem nhẹ khi công cụ chỉ thuận tiện cho một bảng chữ khác. Thử thách mới khiến việc sắp xếp trở thành trung tâm câu chuyện. Trên bàn, các thẻ ít gặp được ghép thành nhóm, rồi nhóm lại tham gia vào lần ghép tiếp. Người nhận còn cần biết cách đi ngược cấu trúc ấy. Nếu ta chỉ khoe phần thông điệp ngắn đi mà giấu bảng mã phải gửi kèm, phép so sánh sẽ thiếu một phần công việc. Bạn có thể gặp kết quả hơi trái mong đợi: một câu rất ngắn trở nên dài hơn khi đóng gói. Đó không phải thất bại cần che giấu. Nó cho thấy lời hứa tiết kiệm luôn phải chỉ rõ mình đã tính những gì.

### Human EN

This time you may not remove any words. The sender’s chosen sentence must return byte for byte, including Vietnamese accents that tools designed around another alphabet can too easily disregard. That requirement makes arrangement the center of the story. On the table, uncommon cards are joined into groups, and those groups take part in later joins. The receiver also needs a way to reverse the arrangement. If we celebrate a shorter message while hiding the codebook that must accompany it, our comparison omits part of the work. You may encounter a result that feels surprising: a very short sentence becomes larger once it is packaged. That is not an embarrassing failure to conceal. It shows why a promise of efficiency must explain what has been counted, what is shared, and what still needs to travel.

### Technical VI

Lab dựng mã Huffman trên các byte UTF-8, với quy tắc phá hoà cố định để kết quả tái lập được. Bộ nhận dựng lại cây từ thông tin được gửi, không đọc trộm cây của phía mã hoá. Tổng dung lượng gồm header, bảng tần suất, payload và bit đệm. Định dạng này được thiết kế cho bài học, không phải ZIP hay một chuẩn truyền tin. Kiểm tra cuối cùng so sánh byte chính xác; hai câu nhìn giống nhau chưa đủ để chứng minh dữ liệu gốc được khôi phục nguyên vẹn.

### Technical EN

The lab builds a Huffman code over UTF-8 bytes, using a fixed tie-breaking rule so results can be reproduced. The receiver rebuilds the tree from transmitted information rather than secretly borrowing the encoder’s tree. Total size includes the header, frequency table, payload and padding. This container is designed for the lesson; it is not ZIP or a communication standard. The final check compares exact bytes. Two strings that look alike are not sufficient evidence that the original data has been recovered without alteration.

**Question VI:** Khi một công cụ nói “tiết kiệm”, bạn sẽ muốn xem những phần chi phí nào trong phép tính?

**Question EN:** When a tool promises savings, which costs would you want included in the calculation?

**Alt VI:** Thẻ ký hiệu và giấy can được sắp thành các nhóm trên bàn, cạnh bản ghi đầy đủ chưa bị gạch chữ.

**Alt EN:** Symbol cards and tracing paper are grouped on a desk beside an intact, unedited record.

**Caption VI:** Minh hoạ: thay cách biểu diễn, không bỏ đi nội dung của thông điệp.

**Caption EN:** Illustration: changing the representation without deleting the message’s contents.

## Cảnh 09 — Những bit tưởng như thừa / Bits That Seem Unnecessary

**Period VI:** Một thí nghiệm mã lặp cổ điển

**Period EN:** A classical repetition-code experiment

**Sources:** `mit-code`, `ibm-repetition`

### Human VI

Vừa học cách làm thông điệp gọn hơn, bạn lại được đề nghị viết thêm. Trên bàn thử có ba bản của cùng một nhóm bit. Không bản nào chứa một ý mới. Chúng tồn tại để người nhận có thêm dấu vết đối chiếu khi một phần bị đổi. Hãy hình dung người kiểm tra không có cơ hội gọi lại phía gửi. Họ phải quyết định từ những gì đang nằm trước mặt, nhưng thời gian và đường truyền vẫn có giới hạn. Mỗi bản sao dùng thêm nguồn lực mà một thông điệp khác cũng có thể cần. Bài thử không trao cho bạn một nút làm mọi thứ đáng tin hơn miễn phí. Nó cho bạn lựa chọn, rồi hiện cả phần được và phần phải trả. Khi lỗi tập trung vào cùng một nhóm, đa số cũng có thể nhất trí về một kết quả sai.

### Human EN

After learning to make a message smaller, you are asked to write more. Three copies of the same bit group sit on the experimental table. None contains a new idea. They give the receiver more evidence to compare when part of the transmission changes. Imagine a checker who cannot call the sender back and must decide from what is already on the desk. Time and channel resources are still limited. Each additional copy uses resources another message might also need. The experiment does not offer a button that makes everything reliable at no cost. It offers a choice, then shows both the benefit and the price. When errors concentrate within one group, a majority can agree on the wrong result. Agreement among copies is useful evidence, but its value depends on how those copies could have been damaged.

### Technical VI

Mã lặp ba biến mỗi bit thành ba bit giống nhau, rồi giải mã bằng biểu quyết. Chúng đi liên tiếp qua kênh mô phỏng, không phải ba mạng vật lý độc lập. Lab tách lỗi độc lập khỏi một đoạn lỗi liên tiếp và hiển thị cả số lần dùng kênh. Một công thức xác suất đúng dưới giả định độc lập không tự đúng cho lỗi dồn cụm. Bạn có thể xem cả trường hợp biểu quyết khôi phục được dữ liệu và trường hợp nó tạo ra một quyết định sai.

### Technical EN

The three-copy repetition code replaces each bit with three identical bits and decodes by majority vote. Those bits travel consecutively through the simulated channel, not through three physically separate networks. The lab distinguishes independent flips from a contiguous burst and displays the number of channel uses. A probability formula derived under independence does not automatically apply to clustered errors. You can inspect both a case where majority voting restores the original data and a case where it produces an incorrect decision despite agreement between two copies.

**Question VI:** Khi nhiều nguồn cùng nói một điều, bạn có biết chúng thật sự độc lập với nhau không?

**Question EN:** When several sources agree, do you know whether they are actually independent?

**Alt VI:** Ba dải giấy ghi cùng một nhóm thông tin được đặt cạnh nhau, với các dấu sửa khác vị trí.

**Alt EN:** Three strips representing the same information are placed side by side, with corrections at different positions.

**Caption VI:** Minh hoạ: phần lặp lại tạo khả năng đối chiếu, nhưng cũng dùng thêm nguồn lực.

**Caption EN:** Illustration: repetition creates opportunities to compare, while using additional resources.

## Hồi 4 — Đến nơi chưa phải là kết thúc / Arrival Is Not the End

**Question VI:** Khi nào ta có thể nói thông điệp đã tới, và câu ấy thực sự khẳng định điều gì?

**Question EN:** When can we say the message has arrived, and what exactly does that claim establish?

**Consequence VI:** Một hệ thống đáng tin cần nêu rõ cả việc nó làm được lẫn trường hợp nó phải từ chối kết luận. Người nhận vẫn còn công việc sau khi máy dừng kiểm tra.

**Consequence EN:** A trustworthy system must state both what it can establish and when it must withhold a conclusion. The receiver still has work to do after the machine finishes checking.

## Cảnh 10 — Tìm đúng chỗ sai / Finding the Error

**Period VI:** Mã kiểm tra lỗi và một khối tám bit

**Period EN:** Error checks and an eight-bit block

**Sources:** `hamming-1950`, `mit-code`

### Human VI

Một người kiểm tra đặt các tờ giấy can lên cùng một bản ghi. Mỗi tờ làm rõ một nhóm vị trí khác nhau. Đây là ẩn dụ hình ảnh của bài, không phải ảnh tư liệu về cách Hamming làm việc. Bạn sẽ thấy các phép kiểm tra có thể phối hợp để chỉ ra nơi cần sửa, thay vì yêu cầu người nhận đoán cả thông điệp từ đầu. Nhưng cảnh này cũng dành chỗ cho một câu thường khó nói trong thiết kế sản phẩm: hệ thống đã thấy có vấn đề mà chưa đủ khả năng sửa nó. Khi hai bit bị đổi trong khối đang thử, từ chối nhận khối có thể là kết quả đúng. Một dấu cảnh báo như vậy không có nghĩa người dùng làm bài kém. Nó thể hiện ranh giới của công cụ và giữ cho công cụ không che sự không chắc chắn bằng một câu trả lời tự tin.

### Human EN

A checker places sheets of tracing paper over the same record. Each sheet makes a different group of positions visible. This is the edition’s visual metaphor, not an archival image of how Hamming worked. You will see checks cooperate to locate a possible repair instead of asking a receiver to guess an entire message again. The scene also makes room for a sentence that products can find difficult to say: the system has detected a problem but cannot safely fix it. When two bits change in the block being tested, refusing to accept the block can be the correct result. Such a warning does not mean that the learner has performed badly. It exposes the tool’s boundary and prevents the tool from hiding uncertainty behind a confident-looking answer. Knowing when to stop is part of the design.

### Technical VI

Lab dùng mã Hamming mở rộng với bốn bit dữ liệu và bốn bit kiểm tra. Trong phạm vi một lỗi, các phép parity cho phép xác định và sửa bit; với hai lỗi, bộ nhận phát hiện rồi từ chối khối. Bảo đảm này không mở rộng sang mọi số lỗi. Chế độ nâng cao cho phép thử vượt giới hạn để quan sát kết quả sai hoặc không bị phát hiện. Giao diện phân biệt điều bộ giải mã báo với điều simulator biết từ bản gốc, không dùng tri thức phía gửi để gian lận việc giải mã.

### Technical EN

The lab uses an extended Hamming code with four data bits and four check bits. Within its stated error bound, parity checks locate and correct a single changed bit; two changes are detected and the block is rejected. That guarantee does not cover arbitrary numbers of errors. An advanced mode lets you cross the boundary and inspect incorrect or undetected outcomes. The interface distinguishes what the decoder reports from what the simulator knows by comparison with the original. The decoder cannot secretly consult the sender’s data to repair a block.

**Question VI:** Bạn muốn một công cụ làm gì khi nó biết có lỗi nhưng không đủ thông tin để sửa?

**Question EN:** What should a tool do when it detects an error but lacks enough information to repair it?

**Alt VI:** Các lớp giấy can soi lên cùng một tấm thẻ dưới ánh đèn, mỗi lớp làm rõ một nhóm vị trí.

**Alt EN:** Layers of tracing paper lie over a card under a lamp, each highlighting a different group of positions.

**Caption VI:** Minh hoạ: các phép kiểm tra chéo có thể tìm lỗi trong một phạm vi được xác định.

**Caption EN:** Illustration: overlapping checks can locate errors within a stated boundary.

## Cảnh 11 — Một đường truyền có thể chịu được bao nhiêu? / How Much Can a Channel Carry?

**Period VI:** Lựa chọn mã trong một kênh nhị phân lý tưởng hoá

**Period EN:** Choosing codes for an idealized binary channel

**Sources:** `mit-capacity`, `mit-code`, `shannon-1948`

### Human VI

Người thiết kế có ba phương án trước mặt, nhưng chỉ một ngân sách truyền. Phương án ít dùng kênh nhất không có cùng lớp bảo vệ với hai phương án còn lại. Phương án thêm nhiều bit hơn cũng không được phép lờ đi thời gian mà nó chiếm. Trong bàn thử này, bạn phải đưa cả thông điệp qua giới hạn đã chọn, không thể bỏ đoạn cuối rồi gọi đó là thành công. Một lần chạy có thể khiến lựa chọn trông rất tốt; nhiều lần chạy có thể làm bức tranh thay đổi. Bạn được xem các trường hợp nhận đúng, từ chối và chấp nhận sai riêng biệt. Sự trung thực nằm ở cách trình bày ấy: hệ thống không gom những kết quả khác nhau vào một chỉ số đẹp, và không dùng một đường giới hạn lý thuyết để bảo đảm những gì một mã ngắn cụ thể chưa làm được.

### Human EN

A designer has three options on the desk but only one transmission budget. The option using the fewest channel resources does not offer the same protection as the others. The option adding more bits cannot ignore the time and capacity it consumes. At this table, the whole message must fit the chosen budget; dropping its final sentence and calling the result successful is not allowed. A single run may make one choice look excellent, while repeated runs can change the picture. You can inspect exact recoveries, rejected transmissions and incorrectly accepted data separately. Honesty lies partly in that presentation. The system does not fold different outcomes into one flattering number, and it does not use a theoretical boundary to guarantee something a particular short code has not demonstrated under the conditions you actually tested.

### Technical VI

Ba mã được so sánh trên cùng thông điệp UTF-8 chưa nén và cùng mô hình kênh. Lab tính số lần dùng kênh, tốc độ dữ liệu và tỷ lệ khôi phục chính xác trong một tập lần thử hữu hạn. Capacity của kênh nhị phân đối xứng được đặt ở bảng lý thuyết riêng. Định lý tiệm cận không bảo đảm mã ngắn đang chọn sẽ chạy tốt chỉ vì rate nằm dưới capacity; một lần thành công cũng không chứng minh độ tin cậy dài hạn. Phần header, truyền lại và đồng bộ gói nằm ngoài mô hình.

### Technical EN

The three codes are compared using the same uncompressed UTF-8 message and channel model. The lab counts channel uses, useful rate and exact recovery within a finite set of trials. Binary symmetric channel capacity appears in a separate theory panel. An asymptotic theorem does not guarantee that a selected short code works well merely because its rate lies below capacity, and one successful transmission does not establish long-term reliability. Headers, retransmission and packet synchronization are outside this model. Observed results and theoretical limits remain visibly distinct.

**Question VI:** Nếu phải chọn cho một hệ thống thật, còn điều gì quan trọng mà bảng thử này chưa đo?

**Question EN:** If you had to choose for a real system, what important factors would this experiment still leave unmeasured?

**Alt VI:** Ba cấu hình dụng cụ khác nhau và một sổ ngân sách nằm trên bàn làm việc của người thiết kế.

**Alt EN:** Three equipment arrangements and a resource ledger sit on a designer’s workbench.

**Caption VI:** Minh hoạ: độ tin cậy và tốc độ cần được cân nhắc cùng nguồn lực và giả định.

**Caption EN:** Illustration: reliability and speed must be considered alongside resources and assumptions.

## Cảnh 12 — Đúng từng chữ, khác một ý / Every Word Intact, Meaning Uncertain

**Period VI:** Trở lại với người nhận hư cấu ở cảnh đầu

**Period EN:** Returning to the fictional receiver from the opening

**Sources:** `shannon-1948`, `morse-archive`

### Human VI

Tờ giấy cuối cùng nằm trên chiếc bàn từng để trống. Người nhận đọc câu bạn đã chọn, nhưng chúng ta không vẽ sẵn một nụ cười để quyết định thay họ rằng mọi chuyện đã ổn. Bạn biết những byte nào đã được giữ lại; bạn không vì thế biết toàn bộ điều người kia mang vào lúc đọc. Có thể họ đã bỏ lỡ câu trước, vừa trải qua một bất đồng hoặc đang chờ một chi tiết bạn tưởng không cần nhắc. Các bối cảnh ấy là gợi ý hư cấu để suy nghĩ, không phải chẩn đoán về một người thật. Khi đổi bối cảnh trong lab, chữ sẽ không đổi. Bạn có thể thấy cách đọc của mình đổi, hoặc không. Đến đây, hành trình không kết bằng một máy đo sự thấu hiểu. Nó trả lại cho hai con người phần công việc mà đường truyền không thể tự nhận đã làm xong.

### Human EN

The paper finally rests on the table that was empty at the beginning. The receiver reads your chosen sentence, but we do not paint a smile onto their face to decide on their behalf that everything is resolved. You know which bytes were preserved. That does not tell you everything another person brings to the moment of reading. Perhaps they missed an earlier sentence, have just experienced a disagreement, or are waiting for a detail you thought unnecessary. These contexts are fictional invitations to reflect, not diagnoses of a real person. When you change the context in the lab, the words remain unchanged. Your reading may change, or it may not. The journey therefore ends without a machine that measures understanding. It returns to two people the work that a communication channel cannot simply declare complete for them.

### Technical VI

Phần đối chiếu chỉ sử dụng kết quả truyền còn khớp phiên bản thông điệp hiện tại. Nếu chưa chạy, bị từ chối hoặc bạn đã sửa câu sau lần chạy, giao diện nói rõ trạng thái đó. Các bối cảnh không tác động byte hoặc kết quả giải mã. Chúng cũng không được gửi cho AI để chấm cách hiểu. Kiểm tra dữ liệu chính xác là một phát biểu hẹp, có thể kiểm chứng; bài này không biến nó thành thước đo cảm xúc, ý định hay mức độ hai người đã hiểu nhau.

### Technical EN

The comparison uses only a transmission result that matches the current revision of the message. If no run exists, the transmission was rejected, or you edited the sentence afterward, the interface states that condition explicitly. Context choices do not alter bytes or decoding results. They are not sent to an AI to grade your interpretation. Exact data recovery is a narrow, testable claim. This edition does not turn it into a measure of emotion, intention or how well two people understand one another.

**Question VI:** Khi những chữ đã tới đúng, bạn còn muốn hỏi người bên kia điều gì?

**Question EN:** Once the words have arrived intact, what would you still want to ask the person on the other side?

**Alt VI:** Căn phòng chờ ở cảnh đầu nhìn từ phía người nhận, tờ giấy đã được đặt lên bàn trong ánh sáng ấm.

**Alt EN:** The waiting room from the opening, now seen from the receiver’s side, with the message on a table in warm light.

**Caption VI:** Minh hoạ hư cấu: thông điệp đến nơi, cuộc trao đổi vẫn còn tiếp tục.

**Caption EN:** Illustration of a fictional situation: the message arrives, and the exchange continues.

## Coda

**VI:** Ta đã học cách đưa những dấu hiệu đến nơi. Hiểu nhau vẫn là công việc của con người.

Bạn có thể quay lại bất kỳ bàn thử nào, thay một giả định và xem điều gì đổi khác. Nếu muốn đi sâu hơn vào xác suất, entropy và giới hạn truyền tin, hãy tiếp tục với phần học có hệ thống.

**EN:** We have learned how to carry signs across a distance. Understanding one another remains human work.

You can return to any experiment, change an assumption and see what follows. To explore probability, entropy and communication limits more deeply, continue into a structured course.

**Course CTA VI:** Học tiếp ***REMOVED***

**Course CTA EN:** Continue with Information Theory

**Catalog fallback VI:** Khám phá các khoá học

**Catalog fallback EN:** Explore the courses

**Collection CTA VI:** Trở lại các số đặc san

**Collection CTA EN:** Back to all special editions

CTA khoá chỉ hiện khi catalog thực có `***REMOVED***`. Không suy ra khoá đã có bản tiếng Anh từ việc giao diện CTA là tiếng Anh.

## Copy công khai về mô hình và dữ liệu

| VI | EN |
|---|---|
| Thí nghiệm này dùng dữ liệu giả lập. | This experiment uses simulated data. |
| Đây là mô hình dạy học, không phải bản phục dựng thiết bị lịch sử. | This is a teaching model, not a reconstruction of historical equipment. |
| Câu của bạn không được dịch khi đổi ngôn ngữ giao diện. | Your message is not translated when you change the interface language. |
| Bạn đang xem kết quả của câu trước. Chạy lại để thử câu hiện tại. | You are viewing a result for the previous message. Run again to test the current one. |
| Chưa có kết quả truyền cho câu này. | There is no transmission result for this message yet. |
| Những byte nhận được không khớp bản gốc. | The received bytes do not match the original. |
| Dữ liệu khớp chính xác; điều này không chấm cách hiểu của người nhận. | The data matches exactly; this does not grade the receiver’s understanding. |

Nhãn từ điển: dấu hiệu / sign; ký hiệu / symbol; cụm ký tự / grapheme cluster; byte / byte; mã hoá biểu diễn / encoding; nén không mất mát / lossless compression; mã sửa lỗi / error-correcting code; giải mã / decoding; ngữ nghĩa / meaning. Không dùng “mã hoá” để ám chỉ encryption trong số này.

## Copy fallback tĩnh của 12 lab

Mọi fallback kèm nhãn “Ví dụ tĩnh / Static example”, title và instruction của lab. Cột dưới là phần giải thích dùng được khi module không tải; sơ đồ/bảng cụ thể theo đặc tả lab. Không tạo kết quả tương tác giả.

| Cảnh | Giải thích VI | Explanation EN |
|---|---|---|
| 01 | Hai bản rút lời đều ngắn hơn bản gốc nhưng bỏ những chi tiết khác nhau. Bộ đếm kiểm tra giới hạn, không đánh giá điều người nhận cần biết. | Both shortened drafts are smaller than the original, but they omit different details. The counter checks the budget, not what the receiver needs to know. |
| 02 | Với A=0, B=01 và C=1, chuỗi 01 có thể đọc thành B hoặc AC. Chỉ nhận đúng các bit chưa đủ để chọn một cách phân đoạn. | With A=0, B=01 and C=1, the sequence 01 can mean B or AC. Receiving the bits correctly is not enough to choose a segmentation. |
| 03 | Một dấu chấm và một dấu gạch, cách nhau ba đơn vị, có thể đọc thành E rồi T. Thu khoảng cách còn một đơn vị làm chúng thành cùng một chữ A trong bộ giải mã này. | A dot and a dash separated by three units can be read as E followed by T. Reducing the gap to one unit combines them into A in this decoder. |
| 04 | Ba tuyến giả lập có chi phí 27, 31 và 21 đơn vị. Những số này đến từ hàm chi phí công khai, không phải giá thành đặt cáp lịch sử. | The three fictional routes cost 27, 31 and 21 units. Those values come from the stated cost function, not historical cable-laying prices. |
| 05 | Hai đồ thị dùng cùng mẫu bit và cùng bộ lọc, chỉ khác thời gian giữ xung. Bảng lấy mẫu cho biết bộ nhận đã quyết định bit nào. | The two graphs use the same bit pattern and filter but different pulse durations. The sampling table shows the receiver’s actual bit decisions. |
| 06 | Ví dụ chỉ ra một vị trí bit bị lật và byte nhận tương ứng. Một byte đổi có thể vẫn đọc được hoặc làm hỏng cách giải mã văn bản. | The example marks one flipped bit and the corresponding received byte. A changed byte may remain readable or invalidate the text decoding. |
| 07 | Nguồn luôn cho một ký hiệu có entropy bằng không; nguồn bốn ký hiệu ngang nhau có entropy hai bit trên ký hiệu. Đây không phải điểm đo ý nghĩa. | A source that always produces one symbol has zero entropy; four equally likely symbols have two bits per symbol. This is not a score for meaning. |
| 08 | Trong định dạng dạy học, AAAA cần bốn bit payload nhưng tổng gói là 96 bit khi cộng header và phần đệm. Giải mã vẫn trả lại đủ bốn byte gốc. | In the teaching format, AAAA needs four payload bits but 96 total bits after the header and padding. Decoding still returns all four original bytes. |
| 09 | Khối 000 thành 100 vẫn được biểu quyết về 0. Thành 110 thì biểu quyết sai về 1. Số bản sao không loại bỏ giới hạn của mô hình lỗi. | A block changing from 000 to 100 still votes to 0. Changing to 110 makes it vote incorrectly to 1. More copies do not remove the error model’s limits. |
| 10 | Khối dữ liệu 1011 được bảo vệ thành 01100110 theo thứ tự bit đã ghi. Một bit lật có thể sửa; hai bit lật phải bị phát hiện và từ chối. | Data block 1011 becomes 01100110 with the stated bit order. One flipped bit can be repaired; two flipped bits must be detected and rejected. |
| 11 | Ba mã dùng lượng kênh khác nhau cho cùng dữ liệu. Bảng ví dụ phân biệt rate, overhead và kết quả; đường capacity không bảo đảm mã ngắn đạt độ tin cậy mong muốn. | The three codes use different channel resources for the same data. The example separates rate, overhead and outcomes; the capacity curve does not guarantee a short code’s reliability. |
| 12 | Cùng một câu mẫu được đặt trong ba bối cảnh hư cấu. Đổi bối cảnh không đổi byte. Bài thử không chấm cách hiểu nào là đúng. | The same example sentence appears in three fictional contexts. Changing context does not change its bytes. The experiment does not grade one interpretation as correct. |
