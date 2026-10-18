/*-----------------------------------------------------------------
  Rome Pharma - main.js
-------------------------------------------------------------------
        01. Mobile Menu
        02. Sidebar Toggle
        03. Sticky Header
        04. Wow Animation
        05. Set Background Image
        06. Back to top
        07. Mouse Cursor
        08. Dil seçimi (TR / EN)
        09. İletişim formu
        10. Harita (tıklayınca yükle)
        11. Çerez bildirimi + Analytics
        12. Telif yılı
        13. Preloader
------------------------------------------------------------------*/

(function ($) {
    "use strict";

    // Google Analytics 4 ölçüm kimliği (ör. "G-XXXXXXXXXX").
    // Boş bırakılırsa Analytics hiç yüklenmez. Doluysa yalnızca
    // ziyaretçi çerez bildiriminde "Kabul et" derse yüklenir.
    var GA_MEASUREMENT_ID = "";

    var LANG_KEY = "rome_lang";
    var CONSENT_KEY = "rome_cookie_consent";
    var pageLang = document.documentElement.lang === "en" ? "en" : "tr";

    function storageGet(key) {
        try { return window.localStorage.getItem(key); } catch (e) { return null; }
    }
    function storageSet(key, value) {
        try { window.localStorage.setItem(key, value); } catch (e) { /* gizli sekme vb. */ }
    }

    var i18n = {
        tr: {
            sending: "Gönderiliyor...",
            success: "Teşekkürler! Mesajınız bize ulaştı, en kısa sürede dönüş yapacağız.",
            error: "Mesaj gönderilemedi. Lütfen tekrar deneyin veya fevziaydin@rome-pharma.com adresine e-posta gönderin.",
            invalid: "Lütfen zorunlu alanları doldurun ve KVKK onay kutusunu işaretleyin.",
            tooBig: "Dosya en fazla 5 MB olabilir."
        },
        en: {
            sending: "Sending...",
            success: "Thank you! Your message has been received. We will get back to you shortly.",
            error: "Your message could not be sent. Please try again or email fevziaydin@rome-pharma.com.",
            invalid: "Please fill in the required fields and tick the privacy consent box.",
            tooBig: "The file can be at most 5 MB."
        }
    };

    $(document).ready(function () {


        /*-----------------------------------
          01. Mobile Menu
        -----------------------------------*/
        $('#mobile-menu').meanmenu({
            meanMenuContainer: '.mobile-menu',
            meanScreenWidth: "1199",
            meanExpand: ['<i class="fa-solid fa-plus"></i>'],
        });



        /*-----------------------------------
          02. Sidebar Toggle
        -----------------------------------*/
        $(".offcanvas__close,.offcanvas__overlay").on("click", function () {
            $(".offcanvas__info").removeClass("info-open");
            $(".offcanvas__overlay").removeClass("overlay-open");
        });
        $(".sidebar__toggle").on("click", function () {
            $(".offcanvas__info").addClass("info-open");
            $(".offcanvas__overlay").addClass("overlay-open");
        });



        /*-----------------------------------
          03. Sticky Header
        -----------------------------------*/
        $(window).scroll(function () {
            if ($(this).scrollTop() > 250) {
                $("#header-sticky").addClass("sticky");
            } else {
                $("#header-sticky").removeClass("sticky");
            }
        });



        /*-----------------------------------
          04. Wow Animation
        -----------------------------------*/
        new WOW().init();



        /*-----------------------------------
          05. Set Background Image
        -----------------------------------*/
        $("[data-bg-src]").each(function () {
            var src = $(this).attr("data-bg-src");
            $(this).css("background-image", "url(" + src + ")");
            $(this).removeAttr("data-bg-src").addClass("background-image");
        });



        /*-----------------------------------
           06. Back to top
        -----------------------------------*/
        $(window).scroll(function () {
            if ($(this).scrollTop() > 20) {
                $("#back-top").addClass("show");
            } else {
                $("#back-top").removeClass("show");
            }
        });
        $("#back-top").click(function () {
            $("html, body").animate({ scrollTop: 0 }, 800);
            return false;
        });



        /*-----------------------------------
            07. Mouse Cursor
        -----------------------------------*/
        (function mousecursor() {
            var e = document.querySelector(".cursor-inner"),
                t = document.querySelector(".cursor-outer");
            if (!e || !t) return;
            window.onmousemove = function (s) {
                t.style.transform = "translate(" + s.clientX + "px, " + s.clientY + "px)";
                e.style.transform = "translate(" + s.clientX + "px, " + s.clientY + "px)";
            };
            $("body").on("mouseenter", "a, .cursor-pointer", function () {
                e.classList.add("cursor-hover");
                t.classList.add("cursor-hover");
            });
            $("body").on("mouseleave", "a, .cursor-pointer", function () {
                if (!($(this).is("a") && $(this).closest(".cursor-pointer").length)) {
                    e.classList.remove("cursor-hover");
                    t.classList.remove("cursor-hover");
                }
            });
            e.style.visibility = "visible";
            t.style.visibility = "visible";
        })();



        /*-----------------------------------
            08. Dil seçimi (TR / EN)
        -----------------------------------*/
        // Kullanıcı dil butonuna bastığında tercihi hatırla.
        $(".lang-switch a, .lang-suggest a").on("click", function () {
            var lang = $(this).attr("hreflang");
            if (lang) storageSet(LANG_KEY, lang);
        });

        // Türkçe sayfada, daha önce dil seçmemiş ve tarayıcısı Türkçe
        // olmayan ziyaretçiye İngilizce sürümü öner (otomatik yönlendirme
        // yok; arama motorları her iki dili de görebilsin diye).
        var $suggest = $(".lang-suggest");
        if ($suggest.length && pageLang === "tr" && !storageGet(LANG_KEY)) {
            var langs = navigator.languages || [navigator.language || ""];
            var prefersTurkish = $.grep(langs, function (l) {
                return /^tr\b/i.test(l || "");
            }).length > 0;
            if (!prefersTurkish) {
                $suggest.addClass("show");
            }
        }
        $(".lang-suggest button").on("click", function () {
            storageSet(LANG_KEY, "tr");
            $suggest.removeClass("show");
        });



        /*-----------------------------------
            09. İletişim formu
        -----------------------------------*/
        $(".js-contact-form").each(function () {
            var $form = $(this);
            var $status = $form.find(".form-status");
            var $button = $form.find("button[type=submit]");
            var t = i18n[pageLang];
            var successText = $form.data("success") || t.success;

            // Bot koruması: formun ne zaman açıldığını kaydet.
            $form.find("input[name=ts]").val(Math.floor(Date.now() / 1000));

            function showStatus(type, text) {
                $status.removeClass("success error").addClass("show " + type).text(text);
            }

            // CV seçildiğinde dosya adını göster, 5 MB sınırını tarayıcıda da kontrol et
            $form.find(".cv-input").on("change", function () {
                var file = this.files && this.files[0];
                var tooBig = file && file.size > 5 * 1024 * 1024;
                this.setCustomValidity(tooBig ? t.tooBig : "");
                $form.find(".cv-name").text(file ? file.name : "");
                if (tooBig) showStatus("error", t.tooBig);
            });

            $form.on("submit", function (ev) {
                if (!window.fetch || !window.FormData) return; // eski tarayıcı: normal POST

                ev.preventDefault();
                if (!this.checkValidity()) {
                    showStatus("error", t.invalid);
                    this.reportValidity && this.reportValidity();
                    return;
                }

                var original = $button.html();
                $button.prop("disabled", true).text(t.sending);

                fetch($form.attr("action"), {
                    method: "POST",
                    body: new FormData(this),
                    headers: { "Accept": "application/json" }
                }).then(function (res) {
                    return res.json().catch(function () { return { ok: false }; });
                }).then(function (data) {
                    if (data && data.ok) {
                        showStatus("success", successText);
                        $form[0].reset();
                        $form.find(".cv-name").text("");
                        $form.find("input[name=ts]").val(Math.floor(Date.now() / 1000));
                    } else {
                        showStatus("error", (data && data.message) || t.error);
                    }
                }).catch(function () {
                    showStatus("error", t.error);
                }).then(function () {
                    $button.prop("disabled", false).html(original);
                });
            });

            // JavaScript'siz gönderimden sonra dönülen sonuç (?sent=1 / ?sent=0)
            var match = /[?&]sent=([01])/.exec(window.location.search);
            if (match) {
                showStatus(match[1] === "1" ? "success" : "error", match[1] === "1" ? successText : t.error);
            }
        });



        /*-----------------------------------
            10. Harita (tıklayınca yükle)
        -----------------------------------*/
        $(".js-load-map").on("click", function () {
            var $box = $(this).closest(".map-consent");
            var $iframe = $("<iframe>", {
                src: $box.data("map-src"),
                title: $box.data("map-title"),
                loading: "lazy",
                referrerpolicy: "no-referrer-when-downgrade",
                allowfullscreen: true
            });
            $box.empty().append($iframe);
        });



        /*-----------------------------------
            11. Çerez bildirimi + Analytics
        -----------------------------------*/
        function loadAnalytics() {
            if (!GA_MEASUREMENT_ID || window.gtag) return;
            var s = document.createElement("script");
            s.async = true;
            s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA_MEASUREMENT_ID);
            document.head.appendChild(s);
            window.dataLayer = window.dataLayer || [];
            window.gtag = function () { window.dataLayer.push(arguments); };
            window.gtag("js", new Date());
            window.gtag("config", GA_MEASUREMENT_ID, { anonymize_ip: true });
        }

        var $banner = $(".cookie-banner");
        var consent = storageGet(CONSENT_KEY);
        if (consent === "accepted") {
            loadAnalytics();
        } else if (!consent) {
            $banner.addClass("show");
        }
        $banner.find(".accept").on("click", function () {
            storageSet(CONSENT_KEY, "accepted");
            $banner.removeClass("show");
            loadAnalytics();
        });
        $banner.find(".reject").on("click", function () {
            storageSet(CONSENT_KEY, "rejected");
            $banner.removeClass("show");
        });
        $(".js-cookie-settings").on("click", function (e) {
            e.preventDefault();
            $banner.addClass("show");
        });



        /*-----------------------------------
            12. Telif yılı
        -----------------------------------*/
        $("[data-current-year]").text(new Date().getFullYear());


    }); // End Document Ready Function



    /*-----------------------------------
        13. Preloader
    -----------------------------------*/
    $(window).on('load', function () {
        $(".preloader").addClass('loaded');
        $(".preloader").delay(600).fadeOut();
    });


})(jQuery); // End jQuery
