import type { Localized, RichTextBlock, SceneId, StoryAct, StoryScene } from '../../types';

interface IssueCopy {
  title: Localized;
  deck: Localized;
  intro: Localized<RichTextBlock[]>;
  acts: StoryAct[];
  scenes: Record<SceneId, Pick<StoryScene, 'period' | 'title' | 'humanStory' | 'technicalHinge' | 'sourceIds' | 'openQuestion'>>;
  imageText: Record<'cover' | SceneId, { alt: Localized; caption: Localized }>;
  coda: Localized<RichTextBlock[]>;
}

// Approved bilingual appendix; only scene 01/12 caption prefixes are normalized.
export const issueCopy: IssueCopy = {
  "title": {"vi":"Một lời nói đi qua đại dương","en":"Across the Noise"},
  "deck": {
    "vi": "Có một người ở bên kia đại dương đang chờ câu trả lời của bạn. Từ dấu hiệu và dây cáp đến nén dữ liệu và sửa lỗi, điều gì giúp lời nói đến nơi — và điều gì vẫn nằm ngoài đường truyền?",
    "en": "Someone across the ocean is waiting for your reply. From symbols and cables to compression and error correction, what helps a message arrive—and what remains beyond the reach of its channel?"
  },
  "intro": {
    "vi": [
      {
        "kind": "paragraph",
        "text": "Bạn có thể mang một câu của mình qua các thí nghiệm trong số này, hoặc dùng câu mẫu. Không cần tài khoản. Thông điệp chỉ được xử lý trong trình duyệt; tải lại trang hoặc rời đặc san sẽ đặt lại lượt thử."
      },
      {
        "kind": "paragraph",
        "text": "Những người gửi và người nhận không tên là nhân vật hư cấu. Tư liệu lịch sử có dẫn nguồn riêng. Các lab dùng mô hình giản lược; chúng không tái tạo một bức điện lịch sử đi qua mọi công nghệ về sau."
      }
    ],
    "en": [
      {
        "kind": "paragraph",
        "text": "Carry your own message through these experiments, or use an example. No account is needed. The message is processed only in your browser; reloading or leaving the edition resets the experiment."
      },
      {
        "kind": "paragraph",
        "text": "The unnamed senders and receivers are fictional. Historical material is sourced separately. The labs use simplified models; they do not recreate a historical telegram passing through technologies developed later."
      }
    ]
  },
  "acts": [
    {
      "id": "act-1",
      "number": 1,
      "title": {"vi":"Trước khi lời nói có thể lên đường","en":"Before Words Can Travel"},
      "question": {
        "vi": "Muốn gửi một điều đi xa, trước hết ta phải biến nó thành thứ gì?",
        "en": "Before sending something far away, what must we turn it into?"
      },
      "consequence": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Người gửi không làm việc một mình. Bảng mã, khoảng nghỉ và người giải mã cùng tham gia tạo ra một thông điệp có thể được nhận lại."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "The sender does not work alone. A codebook, pauses and a decoder all help make a message recoverable."
          }
        ]
      },
      "sceneIds": ["scene-01","scene-02","scene-03"]
    },
    {
      "id": "act-2",
      "number": 2,
      "title": {"vi":"Đại dương không phải khoảng trống","en":"The Ocean Is Not Empty"},
      "question": {
        "vi": "Điều gì xảy ra khi những dấu hiệu phải đi qua vật chất?",
        "en": "What happens when those signs must travel through matter?"
      },
      "consequence": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Một đường truyền cần công xưởng, con tàu, người vận hành và nguồn lực. Khi ta thu gọn nó thành một đường trong sơ đồ, những điều ấy không biến mất."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "A channel needs workshops, ships, operators and resources. Reducing it to a line in a diagram does not make those things disappear."
          }
        ]
      },
      "sceneIds": ["scene-04","scene-05","scene-06"]
    },
    {
      "id": "act-3",
      "number": 3,
      "title": {"vi":"Bớt đi, rồi thêm trở lại","en":"Take Away, Then Add Back"},
      "question": {
        "vi": "Vì sao có lúc ta bỏ bit đi, có lúc lại phải thêm vào?",
        "en": "Why do we sometimes remove bits, then deliberately add them back?"
      },
      "consequence": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Biểu diễn gọn và chống lỗi là hai nhiệm vụ khác nhau. Việc thêm hay bớt chỉ có nghĩa khi biết ta đang bảo toàn điều gì và sử dụng nguồn lực nào."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "Compact representation and error protection are different tasks. Adding or removing bits makes sense only when we know what is being preserved and which resources are being used."
          }
        ]
      },
      "sceneIds": ["scene-07","scene-08","scene-09"]
    },
    {
      "id": "act-4",
      "number": 4,
      "title": {"vi":"Đến nơi chưa phải là kết thúc","en":"Arrival Is Not the End"},
      "question": {
        "vi": "Khi nào ta có thể nói thông điệp đã tới, và câu ấy thực sự khẳng định điều gì?",
        "en": "When can we say the message has arrived, and what exactly does that claim establish?"
      },
      "consequence": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Một hệ thống đáng tin cần nêu rõ cả việc nó làm được lẫn trường hợp nó phải từ chối kết luận. Người nhận vẫn còn công việc sau khi máy dừng kiểm tra."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "A trustworthy system must state both what it can establish and when it must withhold a conclusion. The receiver still has work to do after the machine finishes checking."
          }
        ]
      },
      "sceneIds": ["scene-10","scene-11","scene-12"]
    }
  ],
  "scenes": {
    "scene-01": {
      "period": {"vi":"Một tình huống hư cấu để bắt đầu","en":"A fictional starting point"},
      "title": {"vi":"Có người đang chờ","en":"Someone Is Waiting"},
      "humanStory": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Hãy hình dung bạn vừa đến một bến cảng xa. Bạn muốn báo tin cho một người đã chờ suốt ngày, nhưng câu đầu tiên viết ra dài hơn chỗ trống trên tờ giấy. Bạn bỏ một lời giải thích, rồi một chi tiết tưởng như không cần. Câu còn lại gọn hơn. Nó có còn khiến người nhận yên lòng theo cách bạn muốn không? Trong tình huống hư cấu này, điều quan trọng không phải viết được câu ngắn nhất. Đó là nhận ra mỗi lần rút lời cũng là một lựa chọn về điều người kia sẽ biết. Người nhận không có mặt để hỏi lại ngay. Một từ bạn thấy dư có thể là thứ họ đang chờ. Trước khi chạm tới dây dẫn hay phép tính, việc truyền tin đã có hai con người với hai phần hiểu biết không hoàn toàn giống nhau."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "Imagine that you have just reached a distant harbor. Someone has been waiting all day for news, but your first sentence is longer than the space on the paper. You remove an explanation, then a detail that seems unnecessary. The remaining message is shorter. Will it reassure its reader in the way you intended? In this fictional situation, the goal is not to write the shortest possible sentence. It is to notice that every cut changes what another person can know. The receiver is not beside you to ask a question. A word that feels redundant to you might be exactly what they are waiting for. Before wires or calculations enter the story, communication already involves two people whose knowledge of the situation is not quite the same."
          }
        ]
      },
      "technicalHinge": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Lab đếm ký tự người dùng nhìn thấy và byte UTF-8 riêng biệt. Hai con số trả lời hai câu hỏi khác nhau: câu dài bao nhiêu khi đọc và cần bao nhiêu byte theo cách mã hoá đang dùng. Rút gọn câu bằng cách bỏ lời là biên tập, có thể thay đổi ý; chưa phải nén không mất mát. Chúng ta giữ cả bản gốc và bản rút lời để bạn tự đối chiếu, không dùng thuật toán chấm mức độ bảo toàn ý nghĩa."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "The lab counts visible character clusters separately from UTF-8 bytes. These numbers answer different questions: how long the message appears to a reader, and how many bytes its chosen encoding requires. Removing words is editing and may change meaning; it is not yet lossless compression. Both the original and the shortened draft remain available for comparison. The program checks the stated budget, but it does not assign a score to how faithfully another person would understand your intention."
          }
        ]
      },
      "sourceIds": ["morse-archive","unicode-segmentation"],
      "openQuestion": {
        "vi": "Từ nào bạn sẵn lòng bỏ đi, và từ nào bạn nghĩ người nhận cần nhất?",
        "en": "Which word would you remove, and which one might the receiver need most?"
      }
    },
    "scene-02": {
      "period": {"vi":"Tư liệu 1844 và một bàn mã giả lập","en":"An 1844 artifact and an experimental codebook"},
      "title": {"vi":"Ta phải đồng ý về những dấu hiệu","en":"Agreeing on Signs"},
      "humanStory": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Một dải giấy có dấu không tự đọc thành lời. Có người tạo dấu, người giữ quy ước và người đối chiếu chúng với điều cần hiểu. Tư liệu điện báo năm 1844 nhắc đến Morse ở phía gửi, Alfred Vail ở phía nhận và Annie Ellsworth trong việc chọn câu được truyền. Chi tiết ấy mở rộng khung hình: thành công không chỉ thuộc về một thiết bị hay một tên tuổi. Trở lại bàn thử của chúng ta, hãy tưởng tượng hai người cùng nhận một dải dấu nhưng cầm hai cách chia đoạn khác nhau. Cả hai có thể đọc rất cẩn thận mà vẫn cho ra hai câu. Vấn đề không nằm ở việc ai tập trung hơn. Họ chưa có một quy ước đủ rõ để cùng biết mỗi dấu bắt đầu, kết thúc và đại diện cho điều gì."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "A marked strip of paper does not read itself. Someone makes the marks, someone maintains the convention, and someone relates them to what must be understood. The record of the 1844 demonstration identifies Morse at the sending end, Alfred Vail at the receiving end, and Annie Ellsworth in the choice of the message. That detail widens the picture beyond a single device or inventor. At our experimental table, imagine two careful readers holding the same strip but dividing it differently. They may both follow their instructions faithfully and still arrive at different readings. The problem is not necessarily carelessness. Their shared convention does not yet tell them clearly enough where a sign begins, where it ends, and what it represents. The codebook is part of the working communication system, not an accessory to it."
          }
        ]
      },
      "technicalHinge": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Khi các mã ký hiệu được nối lại, người nhận cần tìm được ranh giới giữa chúng. Lab cho phép bạn tạo bảng mã có nhiều cách phân đoạn, rồi hiện các kết quả giải mã hợp lệ. Một bảng mã prefix-free tránh việc mã của ký hiệu này là phần đầu của mã khác. Đây là một cách thiết kế hữu ích, không phải lời khẳng định rằng mọi bảng có quan hệ prefix đều khiến mọi thông điệp nhập nhằng. Ta kiểm tra chuỗi thật đã gửi."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "When symbol codes are concatenated, a receiver must recover their boundaries. This lab lets you build a codebook with competing segmentations and displays the valid readings of the actual transmitted sequence. A prefix-free code prevents one complete codeword from being the beginning of another. That is a useful design property, not a claim that every codebook containing a prefix relationship makes every possible message ambiguous. We examine the sequence you sent instead of confusing a warning about the codebook with proof about each message."
          }
        ]
      },
      "sourceIds": ["morse-tape","morse-archive","huffman-1952"],
      "openQuestion": {
        "vi": "Phần nào của một quy ước thường bị xem là hiển nhiên cho tới khi hai người hiểu khác nhau?",
        "en": "Which part of a convention feels obvious until two people interpret it differently?"
      }
    },
    "scene-03": {
      "period": {
        "vi": "Quy ước Morse quốc tế, không phải bản phục dựng 1844",
        "en": "International Morse conventions, not an 1844 reconstruction"
      },
      "title": {"vi":"Khoảng lặng cũng mang thông tin","en":"Silence Carries Information"},
      "humanStory": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Hãy nhìn bàn tay người vận hành trong cảnh minh hoạ. Lúc ngón tay dừng lại, công việc chưa dừng. Khoảng nghỉ là phần họ phải tạo ra và người bên kia phải nhận biết. Nếu chỉ giữ những tiếng gõ mà bỏ hết khoảng cách, ta có thể bảo toàn các dấu nhưng làm mất cách chia lời. Trong bàn thử, bạn sẽ không cần nghe giỏi hoặc thuộc bảng mã. Những đoạn im lặng được đặt lên cùng một thước thời gian với dấu chấm và gạch. Bạn có thể chỉ vào chúng, kéo dài chúng và nhìn kết quả đổi khác. Cảnh này dành sự chú ý cho một loại lao động dễ biến mất trong câu chuyện phát minh: giữ đúng nhịp để người khác có thể tiếp tục công việc của mình mà không phải đoán mọi ranh giới."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "Look at the operator’s hand in this illustration. When the finger stops moving, the work has not stopped. The pause is something the sender must produce and the receiver must recognize. If we preserve every mark but remove the intervals, we can keep the visible signs while losing the way they divide into words. At this experimental table, you do not need trained hearing or a memorized codebook. Silence is placed on the same timeline as dots and dashes. You can point to it, lengthen it and watch the reading change. The scene draws attention to work that can disappear from invention stories: maintaining a rhythm clear enough for another person to continue the task without having to guess at every boundary. An absence of sound is not necessarily an absence of structure."
          }
        ]
      },
      "technicalHinge": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Bài thử dùng quy ước Morse quốc tế hiện đại: dấu gạch dài ba đơn vị, với các khoảng cách chuẩn giữa thành phần, chữ và từ. Bộ giải mã của lab dùng các ngưỡng được công khai để biến khoảng nghỉ thành ranh giới. Đây là mô hình dạy học, không bao quát toàn bộ thao tác vô tuyến. Mẫu Latin được chọn riêng; câu tiếng Việt của bạn không bị bỏ dấu hoặc âm thầm chuyển thành một thông điệp khác để vừa bảng mã."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "The experiment uses modern International Morse timing, with a dash lasting three units and defined gaps within letters, between letters and between words. Its teaching decoder uses explicitly stated thresholds to turn pauses into boundaries. This is not a complete model of radio operating practice. The Latin examples are separate controlled samples. Your Vietnamese message is not stripped of its accents or silently rewritten to fit a codebook that does not represent all its characters. The visual timeline contains everything required to explore the idea without audio."
          }
        ]
      },
      "sourceIds": ["itu-morse","morse-tape"],
      "openQuestion": {
        "vi": "Trong những cuộc trao đổi thường ngày, điều gì đóng vai trò như khoảng nghỉ giữa các dấu?",
        "en": "In everyday exchanges, what plays the role of a pause between marks?"
      }
    },
    "scene-04": {
      "period": {"vi":"Cáp Đại Tây Dương, thế kỷ XIX","en":"Nineteenth-century Atlantic cables"},
      "title": {"vi":"Dưới mỗi thông điệp là một công trình","en":"Infrastructure Beneath Every Message"},
      "humanStory": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Trước khi có người chờ bên máy nhận, có người phải làm việc bên cuộn cáp. Trong khung hình này, boong tàu không phải phông nền cho một nhân vật chính. Những người giữ vật liệu, theo dõi máy và phối hợp thao tác cùng làm nên công trình. Các nỗ lực nối cáp Đại Tây Dương năm 1858 và tuyến thành công năm 1866 cho câu chuyện một nhịp khác với bấm nút rồi nhận kết quả. Vật liệu có thể hỏng, công việc phải làm lại, nguồn lực không tự xuất hiện. Ở bàn thử, bạn sẽ chọn giữa ba tuyến hư cấu. Một tuyến ngắn hơn có thể đi qua nhiều đoạn khó hơn. Những con số không tái hiện chi phí lịch sử; chúng giúp đặt một câu hỏi trước mỗi lựa chọn: ai và thứ gì phải gánh phần công việc mà một đường kẻ trên bản đồ đã che đi?"
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "Before someone could wait beside a receiver, someone had to work beside a cable reel. On this illustrated deck, the ship is not scenery for a lone protagonist. People handling material, watching equipment and coordinating their movements are part of the achievement. The Atlantic cable efforts of 1858 and the successful connection of 1866 give the story a different rhythm from pressing a button and getting a result. Material can fail, work may need repeating, and resources do not appear by themselves. At your experimental table, three fictional routes offer different trade-offs. A shorter path can cross more difficult terrain. These numbers do not reconstruct historical costs. They make a decision visible and ask whose work, and which resources, can disappear when a complicated undertaking becomes a neat line on a map."
          }
        ]
      },
      "technicalHinge": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Bản đồ của lab là dữ liệu giả lập với chiều dài, số đoạn khó và số đoạn sâu đã công bố. Một hàm chi phí đơn giản cộng các thành phần để người đọc kiểm tra được từng bước. Không có đơn vị kilomet hoặc tiền thật, cũng không có xác suất thất bại được gán cho biển lịch sử. Mục tiêu là thấy kết quả phụ thuộc vào điều ta đưa vào mô hình; một phương án tốt theo hàm này chưa chắc tốt theo những tiêu chí chưa được tính."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "The lab’s map is a fictional dataset with declared route lengths, difficult segments and deep segments. A simple cost function adds those components so that you can inspect the calculation step by step. It does not use real kilometers or currency, and it does not assign invented historical failure probabilities to the ocean. The point is to see how a decision depends on what a model includes. A route that looks favorable under this function need not be favorable under criteria the function leaves out."
          }
        ]
      },
      "sourceIds": ["cable-history","cable-object","cable-workers"],
      "openQuestion": {
        "vi": "Nếu thêm điều kiện lao động hoặc tác động môi trường, bạn sẽ muốn biết gì trước khi chọn tuyến?",
        "en": "If working conditions or environmental effects mattered to the decision, what else would you need to know?"
      }
    },
    "scene-05": {
      "period": {"vi":"Một bàn thử kênh truyền giản lược","en":"A simplified channel experiment"},
      "title": {"vi":"Tín hiệu mất hình dạng","en":"When Signals Lose Their Shape"},
      "humanStory": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Hãy hình dung một người đứng trước thiết bị nhận, nhìn những thay đổi nhỏ mà người khác có thể bỏ qua. Người gửi tin rằng mình đã tạo ra các dấu rất rõ. Người nhận chỉ có thể làm việc với điều thực sự đến được chỗ mình. Giữa hai phía là vật chất, không phải một khoảng trống trung lập. Trong cảnh minh hoạ, mắt người vận hành và mảnh cáp cắt lớp được đặt gần nhau để nhắc về mối liên hệ ấy. Ở bàn thử, bạn sẽ gửi cùng một mẫu nhanh hơn mà không thay kênh. Có lúc điều khó đọc không đến từ một dấu bị ai đó xoá. Nó đến từ việc dấu trước vẫn còn ảnh hưởng khi dấu sau đã tới. Muốn tăng tốc, người thiết kế phải hiểu thứ đang mang tín hiệu, không chỉ thúc người vận hành làm nhanh hơn."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "Imagine a receiver watching small changes that another observer might overlook. The sender believes the marks were made clearly. The receiver can work only with what actually arrives. Between those positions lies matter, not a neutral empty space. In the illustration, an operator’s attention and a cut section of cable share the frame to make that relationship visible. At the experimental table, you will send the same pattern faster without changing the channel. A difficult reading does not always mean that somebody erased a mark. It can arise because an earlier mark is still affecting the signal when the next one arrives. Increasing speed therefore requires understanding the thing carrying the signal, not simply asking an operator to work more quickly. The equipment and the pace of work have to be considered together."
          }
        ]
      },
      "technicalHinge": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Lab biến bit thành các mức tín hiệu rồi cho chúng đi qua một bộ lọc đơn giản có trí nhớ. Bạn thay thời gian giữ mỗi mức và vị trí lấy mẫu để quan sát quyết định của bộ nhận. Thí nghiệm này không thêm nhiễu ngẫu nhiên; nó tách riêng ảnh hưởng của kênh lên hình dạng xung. Các đơn vị thời gian là quy ước mô phỏng. Ta không dùng đồ thị này để tính hiệu suất một tuyến cáp lịch sử hoặc khẳng định mọi chuỗi bit đều hỏng ở cùng một tốc độ."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "The lab represents bits as signal levels and passes them through a simple filter with memory. You change how long each level is held and when the receiver samples it. No random noise is added in this experiment: it isolates the channel’s effect on pulse shape. Time is measured in simulation units. This graph is not used to calculate the performance of a historical cable, nor does it imply that every bit pattern fails at one universal speed. The displayed decisions follow the actual chosen pattern and model parameters."
          }
        ]
      },
      "sourceIds": ["mit-isi","cable-object"],
      "openQuestion": {
        "vi": "Khi một hệ thống không theo kịp, liệu vấn đề nằm ở tốc độ con người hay ở cấu trúc công việc?",
        "en": "When a system cannot keep up, is the problem human speed or the structure of the work?"
      }
    },
    "scene-06": {
      "period": {"vi":"Từ câu chữ sang một thí nghiệm lật bit","en":"From written words to a bit-flip experiment"},
      "title": {"vi":"Khi thế giới chen vào","en":"When Noise Interferes"},
      "humanStory": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Hai bản ghi được đặt cạnh nhau trên bàn. Một bản là điều người gửi đã giao cho hệ thống; bản kia là điều phía nhận lấy ra được. Trong tình huống này, người kiểm tra chưa cần biết câu ấy mang tin vui hay tin buồn. Họ cần xác định dữ liệu có đổi không và đổi ở đâu. Công việc có vẻ nhỏ: đối chiếu, đánh dấu, thử lại. Nhưng nếu bỏ qua nó, một dòng chữ nhìn vẫn có vẻ hợp lý có thể được chuyển tiếp như thể nguyên vẹn. Bạn sẽ làm công việc ấy với chính câu đã chọn. Có lần thí nghiệm không tạo lỗi nào; có lần một thay đổi khiến một phần văn bản không còn đọc được. Sự khác nhau ấy không chứng minh kênh đã trở nên tốt hoặc xấu vĩnh viễn. Nó là kết quả của một lần thử trong điều kiện đã đặt."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "Two records sit side by side on the table. One contains what the sender handed to the system; the other contains what the receiver obtained. In this situation, the person checking them does not yet need to know whether the sentence carries good news or bad. They need to know whether the data changed, and where. The work can look modest: compare, mark and try again. Without it, a line that still appears plausible might be passed onward as if it were intact. You will do that work with your own chosen message. Some runs produce no errors. In others, a small change makes part of the text unreadable. Neither outcome proves that the channel has become permanently good or bad. It describes one experiment performed under the conditions you selected."
          }
        ]
      },
      "technicalHinge": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Thí nghiệm dùng kênh nhị phân đối xứng: mỗi bit có cùng xác suất bị đảo, độc lập với các bit khác. Xác suất cấu hình không buộc tỷ lệ lỗi quan sát phải bằng nó trong một thông điệp ngắn. Seed giúp giữ lại cùng mẫu ngẫu nhiên để thử lại. Chúng ta đối chiếu byte gốc và byte nhận, rồi giải mã UTF-8 nghiêm ngặt. Nếu byte không tạo thành văn bản hợp lệ, giao diện nói rõ điều đó thay vì thay ký tự và giả vờ câu đã tới đúng."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "This experiment uses a binary symmetric channel: each bit has the same probability of being flipped, independently of the others. The configured probability does not force the observed error fraction to match it in a short message. A seed makes the random sample reproducible. We compare original and received bytes, then attempt strict UTF-8 decoding. If the received bytes do not form valid text, the interface says so instead of substituting characters and pretending the message arrived correctly. This model does not include every kind of physical interference."
          }
        ]
      },
      "sourceIds": ["shannon-1948","ibm-repetition"],
      "openQuestion": {
        "vi": "Bạn sẽ cần bao nhiêu lần thử, và điều kiện nào, trước khi tin một kênh là đáng tin cậy?",
        "en": "How many trials, under which conditions, would you need before trusting a channel?"
      }
    },
    "scene-07": {
      "period": {"vi":"Một nguồn ký hiệu và câu hỏi về độ bất định","en":"A source of symbols and a question about uncertainty"},
      "title": {"vi":"Không phải tin nào cũng bất ngờ như nhau","en":"Not Every Message Is Equally Surprising"},
      "humanStory": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Hãy hình dung một người ghi chép bắt đầu nhận ra nhịp lặp trong những ký hiệu đi qua bàn mình. Họ không biết câu tiếp theo nói chuyện gì, nhưng có những dấu xuất hiện nhiều hơn những dấu khác. Kinh nghiệm ấy khiến một câu hỏi mới trở nên tự nhiên: nếu các khả năng không ngang nhau, liệu ta có nên dành cho chúng những cách biểu diễn dài như nhau? Bàn thử cố tình thu nhỏ thế giới thành bốn ký hiệu để câu hỏi hiện ra rõ. Bạn có thể làm một ký hiệu gần như chắc chắn xuất hiện, rồi trả nguồn về trạng thái khó đoán hơn. Điều đang thay đổi là cấu trúc xác suất mà bạn đã đặt, không phải phẩm chất hay giá trị của một lời nhắn. Một câu rất quen vẫn có thể là điều quan trọng nhất với người đang đợi nó."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "Imagine someone keeping records who begins to notice recurring patterns in the symbols crossing their desk. They do not know what the next sentence will mean, but some marks appear more often than others. That experience makes a new question natural: if the possibilities are unequal, should we give them equally long representations? The experimental table deliberately reduces the world to four symbols so the question becomes visible. You can make one outcome almost certain, then return the source to a harder-to-predict state. What changes is the probability structure you selected, not the worth or importance of a message. A familiar sentence can still be the most important thing a waiting person hopes to receive. The numerical model is useful precisely because its question is narrower than every question we might ask about words."
          }
        ]
      },
      "technicalHinge": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Entropy trong lab mô tả một nguồn rút ký hiệu độc lập theo các xác suất bạn chọn. Đơn vị là bit trên ký hiệu của nguồn, không phải điểm thông minh hoặc mức ý nghĩa của câu. Khi mọi khả năng ngang nhau, việc đoán khó hơn trường hợp một kết quả đã chắc chắn. Bốn trọng số được chuẩn hoá thành phân phối; nếu tất cả bằng không, mô hình chưa có nguồn hợp lệ để tính. Ta không dùng vài tần suất trong một câu ngắn để tuyên bố đã đo được ngôn ngữ tự nhiên."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "Entropy in this lab describes a source that independently draws symbols using probabilities you choose. The unit is bits per source symbol, not intelligence points or a measure of a sentence’s meaning. Equally likely possibilities are less predictable than a certain outcome. The four weights are normalized into a distribution; if they are all zero, there is no valid source to evaluate. We do not use a handful of frequencies from a short sentence to claim that the full structure of natural language has been measured."
          }
        ]
      },
      "sourceIds": ["shannon-1948","mit-capacity"],
      "openQuestion": {
        "vi": "Có điều gì bạn đã biết chắc nhưng vẫn rất cần nghe một người khác nói ra?",
        "en": "Is there something you already know but still need to hear another person say?"
      }
    },
    "scene-08": {
      "period": {"vi":"Mã Huffman và một định dạng gói phục vụ học tập","en":"Huffman coding and a teaching packet format"},
      "title": {"vi":"Gửi ít hơn mà không bỏ chữ nào","en":"Fewer Bits, Nothing Lost"},
      "humanStory": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Lần này bạn không được bỏ từ nào. Câu người gửi đã chọn phải quay lại đủ từng byte, kể cả những dấu tiếng Việt dễ bị xem nhẹ khi công cụ chỉ thuận tiện cho một bảng chữ khác. Thử thách mới khiến việc sắp xếp trở thành trung tâm câu chuyện. Trên bàn, các thẻ ít gặp được ghép thành nhóm, rồi nhóm lại tham gia vào lần ghép tiếp. Người nhận còn cần biết cách đi ngược cấu trúc ấy. Nếu ta chỉ khoe phần thông điệp ngắn đi mà giấu bảng mã phải gửi kèm, phép so sánh sẽ thiếu một phần công việc. Bạn có thể gặp kết quả hơi trái mong đợi: một câu rất ngắn trở nên dài hơn khi đóng gói. Đó không phải thất bại cần che giấu. Nó cho thấy lời hứa tiết kiệm luôn phải chỉ rõ mình đã tính những gì."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "This time you may not remove any words. The sender’s chosen sentence must return byte for byte, including Vietnamese accents that tools designed around another alphabet can too easily disregard. That requirement makes arrangement the center of the story. On the table, uncommon cards are joined into groups, and those groups take part in later joins. The receiver also needs a way to reverse the arrangement. If we celebrate a shorter message while hiding the codebook that must accompany it, our comparison omits part of the work. You may encounter a result that feels surprising: a very short sentence becomes larger once it is packaged. That is not an embarrassing failure to conceal. It shows why a promise of efficiency must explain what has been counted, what is shared, and what still needs to travel."
          }
        ]
      },
      "technicalHinge": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Lab dựng mã Huffman trên các byte UTF-8, với quy tắc phá hoà cố định để kết quả tái lập được. Bộ nhận dựng lại cây từ thông tin được gửi, không đọc trộm cây của phía mã hoá. Tổng dung lượng gồm header, bảng tần suất, payload và bit đệm. Định dạng này được thiết kế cho bài học, không phải ZIP hay một chuẩn truyền tin. Kiểm tra cuối cùng so sánh byte chính xác; hai câu nhìn giống nhau chưa đủ để chứng minh dữ liệu gốc được khôi phục nguyên vẹn."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "The lab builds a Huffman code over UTF-8 bytes, using a fixed tie-breaking rule so results can be reproduced. The receiver rebuilds the tree from transmitted information rather than secretly borrowing the encoder’s tree. Total size includes the header, frequency table, payload and padding. This container is designed for the lesson; it is not ZIP or a communication standard. The final check compares exact bytes. Two strings that look alike are not sufficient evidence that the original data has been recovered without alteration."
          }
        ]
      },
      "sourceIds": ["huffman-1952","unicode-normalization"],
      "openQuestion": {
        "vi": "Khi một công cụ nói “tiết kiệm”, bạn sẽ muốn xem những phần chi phí nào trong phép tính?",
        "en": "When a tool promises savings, which costs would you want included in the calculation?"
      }
    },
    "scene-09": {
      "period": {"vi":"Một thí nghiệm mã lặp cổ điển","en":"A classical repetition-code experiment"},
      "title": {"vi":"Những bit tưởng như thừa","en":"Bits That Seem Unnecessary"},
      "humanStory": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Vừa học cách làm thông điệp gọn hơn, bạn lại được đề nghị viết thêm. Trên bàn thử có ba bản của cùng một nhóm bit. Không bản nào chứa một ý mới. Chúng tồn tại để người nhận có thêm dấu vết đối chiếu khi một phần bị đổi. Hãy hình dung người kiểm tra không có cơ hội gọi lại phía gửi. Họ phải quyết định từ những gì đang nằm trước mặt, nhưng thời gian và đường truyền vẫn có giới hạn. Mỗi bản sao dùng thêm nguồn lực mà một thông điệp khác cũng có thể cần. Bài thử không trao cho bạn một nút làm mọi thứ đáng tin hơn miễn phí. Nó cho bạn lựa chọn, rồi hiện cả phần được và phần phải trả. Khi lỗi tập trung vào cùng một nhóm, đa số cũng có thể nhất trí về một kết quả sai."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "After learning to make a message smaller, you are asked to write more. Three copies of the same bit group sit on the experimental table. None contains a new idea. They give the receiver more evidence to compare when part of the transmission changes. Imagine a checker who cannot call the sender back and must decide from what is already on the desk. Time and channel resources are still limited. Each additional copy uses resources another message might also need. The experiment does not offer a button that makes everything reliable at no cost. It offers a choice, then shows both the benefit and the price. When errors concentrate within one group, a majority can agree on the wrong result. Agreement among copies is useful evidence, but its value depends on how those copies could have been damaged."
          }
        ]
      },
      "technicalHinge": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Mã lặp ba biến mỗi bit thành ba bit giống nhau, rồi giải mã bằng biểu quyết. Chúng đi liên tiếp qua kênh mô phỏng, không phải ba mạng vật lý độc lập. Lab tách lỗi độc lập khỏi một đoạn lỗi liên tiếp và hiển thị cả số lần dùng kênh. Một công thức xác suất đúng dưới giả định độc lập không tự đúng cho lỗi dồn cụm. Bạn có thể xem cả trường hợp biểu quyết khôi phục được dữ liệu và trường hợp nó tạo ra một quyết định sai."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "The three-copy repetition code replaces each bit with three identical bits and decodes by majority vote. Those bits travel consecutively through the simulated channel, not through three physically separate networks. The lab distinguishes independent flips from a contiguous burst and displays the number of channel uses. A probability formula derived under independence does not automatically apply to clustered errors. You can inspect both a case where majority voting restores the original data and a case where it produces an incorrect decision despite agreement between two copies."
          }
        ]
      },
      "sourceIds": ["mit-code","ibm-repetition"],
      "openQuestion": {
        "vi": "Khi nhiều nguồn cùng nói một điều, bạn có biết chúng thật sự độc lập với nhau không?",
        "en": "When several sources agree, do you know whether they are actually independent?"
      }
    },
    "scene-10": {
      "period": {"vi":"Mã kiểm tra lỗi và một khối tám bit","en":"Error checks and an eight-bit block"},
      "title": {"vi":"Tìm đúng chỗ sai","en":"Finding the Error"},
      "humanStory": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Một người kiểm tra đặt các tờ giấy can lên cùng một bản ghi. Mỗi tờ làm rõ một nhóm vị trí khác nhau. Đây là ẩn dụ hình ảnh của bài, không phải ảnh tư liệu về cách Hamming làm việc. Bạn sẽ thấy các phép kiểm tra có thể phối hợp để chỉ ra nơi cần sửa, thay vì yêu cầu người nhận đoán cả thông điệp từ đầu. Nhưng cảnh này cũng dành chỗ cho một câu thường khó nói trong thiết kế sản phẩm: hệ thống đã thấy có vấn đề mà chưa đủ khả năng sửa nó. Khi hai bit bị đổi trong khối đang thử, từ chối nhận khối có thể là kết quả đúng. Một dấu cảnh báo như vậy không có nghĩa người dùng làm bài kém. Nó thể hiện ranh giới của công cụ và giữ cho công cụ không che sự không chắc chắn bằng một câu trả lời tự tin."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "A checker places sheets of tracing paper over the same record. Each sheet makes a different group of positions visible. This is the edition’s visual metaphor, not an archival image of how Hamming worked. You will see checks cooperate to locate a possible repair instead of asking a receiver to guess an entire message again. The scene also makes room for a sentence that products can find difficult to say: the system has detected a problem but cannot safely fix it. When two bits change in the block being tested, refusing to accept the block can be the correct result. Such a warning does not mean that the learner has performed badly. It exposes the tool’s boundary and prevents the tool from hiding uncertainty behind a confident-looking answer. Knowing when to stop is part of the design."
          }
        ]
      },
      "technicalHinge": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Lab dùng mã Hamming mở rộng với bốn bit dữ liệu và bốn bit kiểm tra. Trong phạm vi một lỗi, các phép parity cho phép xác định và sửa bit; với hai lỗi, bộ nhận phát hiện rồi từ chối khối. Bảo đảm này không mở rộng sang mọi số lỗi. Chế độ nâng cao cho phép thử vượt giới hạn để quan sát kết quả sai hoặc không bị phát hiện. Giao diện phân biệt điều bộ giải mã báo với điều simulator biết từ bản gốc, không dùng tri thức phía gửi để gian lận việc giải mã."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "The lab uses an extended Hamming code with four data bits and four check bits. Within its stated error bound, parity checks locate and correct a single changed bit; two changes are detected and the block is rejected. That guarantee does not cover arbitrary numbers of errors. An advanced mode lets you cross the boundary and inspect incorrect or undetected outcomes. The interface distinguishes what the decoder reports from what the simulator knows by comparison with the original. The decoder cannot secretly consult the sender’s data to repair a block."
          }
        ]
      },
      "sourceIds": ["hamming-1950","mit-code"],
      "openQuestion": {
        "vi": "Bạn muốn một công cụ làm gì khi nó biết có lỗi nhưng không đủ thông tin để sửa?",
        "en": "What should a tool do when it detects an error but lacks enough information to repair it?"
      }
    },
    "scene-11": {
      "period": {"vi":"Lựa chọn mã trong một kênh nhị phân lý tưởng hoá","en":"Choosing codes for an idealized binary channel"},
      "title": {"vi":"Một đường truyền có thể chịu được bao nhiêu?","en":"How Much Can a Channel Carry?"},
      "humanStory": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Người thiết kế có ba phương án trước mặt, nhưng chỉ một ngân sách truyền. Phương án ít dùng kênh nhất không có cùng lớp bảo vệ với hai phương án còn lại. Phương án thêm nhiều bit hơn cũng không được phép lờ đi thời gian mà nó chiếm. Trong bàn thử này, bạn phải đưa cả thông điệp qua giới hạn đã chọn, không thể bỏ đoạn cuối rồi gọi đó là thành công. Một lần chạy có thể khiến lựa chọn trông rất tốt; nhiều lần chạy có thể làm bức tranh thay đổi. Bạn được xem các trường hợp nhận đúng, từ chối và chấp nhận sai riêng biệt. Sự trung thực nằm ở cách trình bày ấy: hệ thống không gom những kết quả khác nhau vào một chỉ số đẹp, và không dùng một đường giới hạn lý thuyết để bảo đảm những gì một mã ngắn cụ thể chưa làm được."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "A designer has three options on the desk but only one transmission budget. The option using the fewest channel resources does not offer the same protection as the others. The option adding more bits cannot ignore the time and capacity it consumes. At this table, the whole message must fit the chosen budget; dropping its final sentence and calling the result successful is not allowed. A single run may make one choice look excellent, while repeated runs can change the picture. You can inspect exact recoveries, rejected transmissions and incorrectly accepted data separately. Honesty lies partly in that presentation. The system does not fold different outcomes into one flattering number, and it does not use a theoretical boundary to guarantee something a particular short code has not demonstrated under the conditions you actually tested."
          }
        ]
      },
      "technicalHinge": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Ba mã được so sánh trên cùng thông điệp UTF-8 chưa nén và cùng mô hình kênh. Lab tính số lần dùng kênh, tốc độ dữ liệu và tỷ lệ khôi phục chính xác trong một tập lần thử hữu hạn. Capacity của kênh nhị phân đối xứng được đặt ở bảng lý thuyết riêng. Định lý tiệm cận không bảo đảm mã ngắn đang chọn sẽ chạy tốt chỉ vì rate nằm dưới capacity; một lần thành công cũng không chứng minh độ tin cậy dài hạn. Phần header, truyền lại và đồng bộ gói nằm ngoài mô hình."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "The three codes are compared using the same uncompressed UTF-8 message and channel model. The lab counts channel uses, useful rate and exact recovery within a finite set of trials. Binary symmetric channel capacity appears in a separate theory panel. An asymptotic theorem does not guarantee that a selected short code works well merely because its rate lies below capacity, and one successful transmission does not establish long-term reliability. Headers, retransmission and packet synchronization are outside this model. Observed results and theoretical limits remain visibly distinct."
          }
        ]
      },
      "sourceIds": ["mit-capacity","mit-code","shannon-1948"],
      "openQuestion": {
        "vi": "Nếu phải chọn cho một hệ thống thật, còn điều gì quan trọng mà bảng thử này chưa đo?",
        "en": "If you had to choose for a real system, what important factors would this experiment still leave unmeasured?"
      }
    },
    "scene-12": {
      "period": {"vi":"Trở lại với người nhận hư cấu ở cảnh đầu","en":"Returning to the fictional receiver from the opening"},
      "title": {"vi":"Đúng từng chữ, khác một ý","en":"Every Word Intact, Meaning Uncertain"},
      "humanStory": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Tờ giấy cuối cùng nằm trên chiếc bàn từng để trống. Người nhận đọc câu bạn đã chọn, nhưng chúng ta không vẽ sẵn một nụ cười để quyết định thay họ rằng mọi chuyện đã ổn. Bạn biết những byte nào đã được giữ lại; bạn không vì thế biết toàn bộ điều người kia mang vào lúc đọc. Có thể họ đã bỏ lỡ câu trước, vừa trải qua một bất đồng hoặc đang chờ một chi tiết bạn tưởng không cần nhắc. Các bối cảnh ấy là gợi ý hư cấu để suy nghĩ, không phải chẩn đoán về một người thật. Khi đổi bối cảnh trong lab, chữ sẽ không đổi. Bạn có thể thấy cách đọc của mình đổi, hoặc không. Đến đây, hành trình không kết bằng một máy đo sự thấu hiểu. Nó trả lại cho hai con người phần công việc mà đường truyền không thể tự nhận đã làm xong."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "The paper finally rests on the table that was empty at the beginning. The receiver reads your chosen sentence, but we do not paint a smile onto their face to decide on their behalf that everything is resolved. You know which bytes were preserved. That does not tell you everything another person brings to the moment of reading. Perhaps they missed an earlier sentence, have just experienced a disagreement, or are waiting for a detail you thought unnecessary. These contexts are fictional invitations to reflect, not diagnoses of a real person. When you change the context in the lab, the words remain unchanged. Your reading may change, or it may not. The journey therefore ends without a machine that measures understanding. It returns to two people the work that a communication channel cannot simply declare complete for them."
          }
        ]
      },
      "technicalHinge": {
        "vi": [
          {
            "kind": "paragraph",
            "text": "Phần đối chiếu chỉ sử dụng kết quả truyền còn khớp phiên bản thông điệp hiện tại. Nếu chưa chạy, bị từ chối hoặc bạn đã sửa câu sau lần chạy, giao diện nói rõ trạng thái đó. Các bối cảnh không tác động byte hoặc kết quả giải mã. Chúng cũng không được gửi cho AI để chấm cách hiểu. Kiểm tra dữ liệu chính xác là một phát biểu hẹp, có thể kiểm chứng; bài này không biến nó thành thước đo cảm xúc, ý định hay mức độ hai người đã hiểu nhau."
          }
        ],
        "en": [
          {
            "kind": "paragraph",
            "text": "The comparison uses only a transmission result that matches the current revision of the message. If no run exists, the transmission was rejected, or you edited the sentence afterward, the interface states that condition explicitly. Context choices do not alter bytes or decoding results. They are not sent to an AI to grade your interpretation. Exact data recovery is a narrow, testable claim. This edition does not turn it into a measure of emotion, intention or how well two people understand one another."
          }
        ]
      },
      "sourceIds": ["shannon-1948","morse-archive"],
      "openQuestion": {
        "vi": "Khi những chữ đã tới đúng, bạn còn muốn hỏi người bên kia điều gì?",
        "en": "Once the words have arrived intact, what would you still want to ask the person on the other side?"
      }
    }
  },
  "imageText": {
    "cover": {
      "alt": {
        "vi": "Một bàn viết cạnh cửa sổ nhìn ra cảng, với con tàu nhỏ trong sương và tờ giấy chưa có chữ.",
        "en": "A writing desk beside a window overlooking a harbor, with a small ship in the mist and an unmarked sheet of paper."
      },
      "caption": {
        "vi": "Minh hoạ: trước khi có đường truyền, có một người muốn nói và một người đang chờ.",
        "en": "Illustration: before there is a channel, there is someone who wants to speak and someone waiting."
      }
    },
    "scene-01": {
      "alt": {
        "vi": "Hai căn phòng tách nhau: một người cúi viết, một người ngồi cạnh bàn còn trống.",
        "en": "Two separate rooms: someone bends over a message while another person sits beside an empty table."
      },
      "caption": {
        "vi": "Minh hoạ: tình huống hư cấu — hai phía của một lời nhắn chưa lên đường.",
        "en": "Illustration: a fictional situation — the two sides of a message not yet sent."
      }
    },
    "scene-02": {
      "alt": {
        "vi": "Hai người đối chiếu những thẻ ký hiệu và một dải giấy trên cùng mặt bàn.",
        "en": "Two people compare symbol cards and a paper strip on a shared table."
      },
      "caption": {
        "vi": "Minh hoạ: dấu hiệu cần cả người vận hành lẫn quy ước để trở thành lời.",
        "en": "Illustration: marks need both operators and conventions to become a message."
      }
    },
    "scene-03": {
      "alt": {
        "vi": "Cận cảnh bàn tay bên cần điện báo và những mảnh giấy đặt cách nhau trên bàn.",
        "en": "A close view of a hand beside a telegraph key and paper fragments spaced across a table."
      },
      "caption": {
        "vi": "Minh hoạ: khoảng nghỉ cũng là một phần của công việc truyền tin.",
        "en": "Illustration: pauses are also part of the work of communication."
      }
    },
    "scene-04": {
      "alt": {
        "vi": "Nhiều công nhân phối hợp quanh cuộn cáp trên boong tàu, phía ngoài là một vùng biển rộng.",
        "en": "Several workers coordinate around a cable reel on a ship’s deck, with open sea beyond them."
      },
      "caption": {
        "vi": "Minh hoạ: đường truyền là một công trình vật chất và lao động tập thể.",
        "en": "Illustration: a channel is a material undertaking built through collective work."
      }
    },
    "scene-05": {
      "alt": {
        "vi": "Người vận hành quan sát máy đo ở trạm bờ, cạnh một đoạn cáp được cắt để thấy các lớp vật liệu.",
        "en": "An operator watches an instrument at a shore station beside a cable section showing its material layers."
      },
      "caption": {
        "vi": "Minh hoạ: người nhận làm việc với tín hiệu đã đi qua vật chất.",
        "en": "Illustration: the receiver works with a signal that has passed through matter."
      }
    },
    "scene-06": {
      "alt": {
        "vi": "Hai bản ghi và dụng cụ kiểm tra trên bàn, với các vị trí khác nhau được người vận hành đánh dấu.",
        "en": "Two records and checking instruments lie on a desk, with differing positions marked by an operator."
      },
      "caption": {
        "vi": "Minh hoạ: đối chiếu dữ liệu là một phần của việc làm cho thông điệp đáng tin.",
        "en": "Illustration: comparing records is part of making a message trustworthy."
      }
    },
    "scene-07": {
      "alt": {
        "vi": "Những thẻ ký hiệu được người ghi chép đếm và xếp thành các nhóm lớn nhỏ khác nhau.",
        "en": "A record keeper counts symbol cards and sorts them into groups of different sizes."
      },
      "caption": {
        "vi": "Minh hoạ: tần suất của dấu hiệu không đo tầm quan trọng của lời nói.",
        "en": "Illustration: the frequency of a symbol does not measure the importance of a message."
      }
    },
    "scene-08": {
      "alt": {
        "vi": "Thẻ ký hiệu và giấy can được sắp thành các nhóm trên bàn, cạnh bản ghi đầy đủ chưa bị gạch chữ.",
        "en": "Symbol cards and tracing paper are grouped on a desk beside an intact, unedited record."
      },
      "caption": {
        "vi": "Minh hoạ: thay cách biểu diễn, không bỏ đi nội dung của thông điệp.",
        "en": "Illustration: changing the representation without deleting the message’s contents."
      }
    },
    "scene-09": {
      "alt": {
        "vi": "Ba dải giấy ghi cùng một nhóm thông tin được đặt cạnh nhau, với các dấu sửa khác vị trí.",
        "en": "Three strips representing the same information are placed side by side, with corrections at different positions."
      },
      "caption": {
        "vi": "Minh hoạ: phần lặp lại tạo khả năng đối chiếu, nhưng cũng dùng thêm nguồn lực.",
        "en": "Illustration: repetition creates opportunities to compare, while using additional resources."
      }
    },
    "scene-10": {
      "alt": {
        "vi": "Các lớp giấy can soi lên cùng một tấm thẻ dưới ánh đèn, mỗi lớp làm rõ một nhóm vị trí.",
        "en": "Layers of tracing paper lie over a card under a lamp, each highlighting a different group of positions."
      },
      "caption": {
        "vi": "Minh hoạ: các phép kiểm tra chéo có thể tìm lỗi trong một phạm vi được xác định.",
        "en": "Illustration: overlapping checks can locate errors within a stated boundary."
      }
    },
    "scene-11": {
      "alt": {
        "vi": "Ba cấu hình dụng cụ khác nhau và một sổ ngân sách nằm trên bàn làm việc của người thiết kế.",
        "en": "Three equipment arrangements and a resource ledger sit on a designer’s workbench."
      },
      "caption": {
        "vi": "Minh hoạ: độ tin cậy và tốc độ cần được cân nhắc cùng nguồn lực và giả định.",
        "en": "Illustration: reliability and speed must be considered alongside resources and assumptions."
      }
    },
    "scene-12": {
      "alt": {
        "vi": "Căn phòng chờ ở cảnh đầu nhìn từ phía người nhận, tờ giấy đã được đặt lên bàn trong ánh sáng ấm.",
        "en": "The waiting room from the opening, now seen from the receiver’s side, with the message on a table in warm light."
      },
      "caption": {
        "vi": "Minh hoạ: tình huống hư cấu — thông điệp đến nơi, cuộc trao đổi vẫn còn tiếp tục.",
        "en": "Illustration: a fictional situation — the message arrives, and the exchange continues."
      }
    }
  },
  "coda": {
    "vi": [
      {"kind":"paragraph","text":"Ta đã học cách đưa những dấu hiệu đến nơi. Hiểu nhau vẫn là công việc của con người."},
      {
        "kind": "paragraph",
        "text": "Bạn có thể quay lại bất kỳ bàn thử nào, thay một giả định và xem điều gì đổi khác. Nếu muốn đi sâu hơn vào xác suất, entropy và giới hạn truyền tin, hãy tiếp tục với phần học có hệ thống."
      }
    ],
    "en": [
      {
        "kind": "paragraph",
        "text": "We have learned how to carry signs across a distance. Understanding one another remains human work."
      },
      {
        "kind": "paragraph",
        "text": "You can return to any experiment, change an assumption and see what follows. To explore probability, entropy and communication limits more deeply, continue into a structured course."
      }
    ]
  }
};
